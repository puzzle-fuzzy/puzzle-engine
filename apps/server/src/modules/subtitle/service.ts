/**
 * 字幕生成核心业务服务
 *
 * 职责：
 *   1. 创建字幕项目 — 上传视频 → 创建 DB 记录 → 提取音频
 *   2. 执行 ASR — 提交 Paraformer-v2 异步转录 → Worker 回调解析
 *   3. 执行导出 — 生成 ASS 文件 + FFmpeg 烧录 + 上传到存储
 *
 * 与 generation/service.ts 类似：纯业务逻辑，不涉及 HTTP 语义。
 */

import type { SubtitleProjectRow, SubtitleStyleConfig } from '@excuse/db'
import type {
  ASRClient,
  AssetStorage,
} from '@excuse/provider'
import type { ServerConfig } from '../../config'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  createSubtitleProject,
  getSubtitleProjectForAccount,
  getUploadedFileById,
  markGenerationSucceeded,
  notifyGenerationStatus,
  updateSubtitleExport,
  updateSubtitleProjectStatus,
  updateSubtitleSentences,
} from '@excuse/db'
import {
  burnSubtitlesToVideo,
  extractAudioFromVideo,
  getMediaDurationMs,
} from '@excuse/provider'
import { sentencesToAss } from '@excuse/shared'

/** 字幕项目依赖的外部服务 */
export interface SubtitleDependencies {
  asrClient: ASRClient
  storage: AssetStorage
}

/**
 * 创建字幕项目 — 上传视频 + 提取音频 + 创建 DB 记录
 *
 * 流程：
 *   1. 校验视频文件归属
 *   2. 创建 subtitle_project DB 记录（draft 状态）
 *   3. 用 FFmpeg 从视频提取音频
 *   4. 获取视频时长
 *   5. 更新项目状态为 extracting_audio → asr_processing
 *   6. 提交 ASR 任务
 *   7. 创建 generation_record 关联
 *   8. 更新项目 asrRecordId
 *   9. SSE 推送状态变更
 */
export async function createAndStartProject(
  accountId: string,
  videoFileId: string,
  config: ServerConfig,
  deps: SubtitleDependencies,
): Promise<SubtitleProjectRow> {
  // 1. 校验视频文件存在
  const file = await getUploadedFileById(videoFileId)
  if (!file || file.accountId !== accountId) {
    throw new Error('视频文件不存在或不属于当前用户')
  }

  // 2. 创建 subtitle_project 记录
  const project = await createSubtitleProject({
    accountId,
    videoFileId,
    videoUrl: file.publicUrl,
    status: 'draft',
  })

  try {
    // 3. 提取音频
    await updateSubtitleProjectStatus(project.id, 'extracting_audio')

    // 下载视频到本地（如果是 OSS URL）
    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    const { audioPath, durationMs: audioDurationMs } = await extractAudioFromVideo(videoPath)
    const videoDurationMs = await getMediaDurationMs(videoPath)

    // 上传音频到存储
    const audioBuffer = await Bun.file(audioPath).arrayBuffer()
    const audioUploadResult = await deps.storage.uploadGenerated(
      Buffer.from(audioBuffer),
      `subtitle/audio_${project.id}.wav`,
      'audio/wav',
    )
    const audioFileUrl = audioUploadResult

    // 清理本地临时文件
    try {
      await Bun.file(audioPath).delete()
    }
    catch {}

    // 4. 提交 ASR 任务
    await updateSubtitleProjectStatus(project.id, 'asr_processing', {
      audioFileUrl,
      videoDurationMs: videoDurationMs || audioDurationMs,
    })

    const asrResult = await deps.asrClient.submitTranscription(audioFileUrl)

    if (!asrResult.success) {
      await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: asrResult.error })
      const failedProject = await getSubtitleProjectForAccount(project.id, accountId)
      return failedProject!
    }

    // 5. 创建 generation_record 关联
    const estimatedCost = calculateCost(
      { id: 'paraformer-v2', category: 'subtitle', pricing: { inputPriceCents: 66, unit: 'video' } } as any,
      { duration: (videoDurationMs || audioDurationMs) / 1000 },
    )

    const asrRecord = await createGenerationRecord({
      accountId,
      taskId: asrResult.taskId,
      traceId: crypto.randomUUID(),
      model: 'paraformer-v2',
      category: 'subtitle',
      status: 'processing',
      inputParams: { audioUrl: audioFileUrl, projectId: project.id },
      cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
    })

    // 6. 更新项目 asrRecordId
    await updateSubtitleProjectStatus(project.id, 'asr_processing', { asrRecordId: asrRecord.id })

    // 7. SSE 通知
    await notifyGenerationStatus({
      accountId,
      recordId: asrRecord.id,
      status: 'processing',
      category: 'subtitle',
      model: 'paraformer-v2',
      taskId: asrResult.taskId,
      traceId: asrRecord.traceId ?? undefined,
    })

    const finalProject = await getSubtitleProjectForAccount(project.id, accountId)
    return finalProject!
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errorMsg })
    throw err
  }
}

/**
 * ASR 任务完成后的回调 — 解析转录结果 + 更新句子列表
 *
 * Worker 在轮询到 ASR 任务 SUCCEEDED 后调用此函数：
 *   1. 下载转录 JSON（从 transcriptionUrl）
 *   2. 用 ASRClient.parseTranscription 提取句子
 *   3. 更新 subtitle_project 的 sentences 和 rawTranscription
 *   4. 更新项目状态为 subtitle_editing
 *   5. 更新 generation_record 为 succeeded
 *   6. SSE 通知
 */
export async function handleASRCompleted(
  recordId: string,
  projectId: string,
  accountId: string,
  transcriptionUrl: string,
  deps: SubtitleDependencies,
): Promise<void> {
  // 1. 下载转录 JSON
  const response = await fetch(transcriptionUrl)
  const rawJson = await response.json()

  // 2. 提取句子列表
  const sentences = deps.asrClient.parseTranscription(rawJson)

  // 3. 更新 subtitle_project 的句子列表和原始转录数据
  await updateSubtitleSentences(projectId, sentences, rawJson)

  // 4. 更新项目状态为 subtitle_editing
  await updateSubtitleProjectStatus(projectId, 'subtitle_editing')

  // 5. 更新 generation_record 为 succeeded
  await markGenerationSucceeded(recordId, {
    type: 'subtitle',
    sentences,
    transcriptionUrl,
  })

  // 6. SSE 通知
  await notifyGenerationStatus({
    accountId,
    recordId,
    status: 'succeeded',
    category: 'subtitle',
    model: 'paraformer-v2',
    taskId: null,
  })
}

/**
 * 执行字幕导出 — 生成 ASS + FFmpeg 烧录 + 上传结果
 *
 * 流程：
 *   1. 生成 ASS 内容（sentences + styleConfig → ASS）
 *   2. 获取原始视频文件
 *   3. FFmpeg 烧录字幕到视频
 *   4. 上传导出视频到存储
 *   5. 创建 generation_record 关联
 *   6. 更新项目状态
 *   7. SSE 通知
 */
export async function executeExport(
  projectId: string,
  accountId: string,
  config: ServerConfig,
  deps: SubtitleDependencies,
): Promise<void> {
  const project = await getSubtitleProjectForAccount(projectId, accountId)
  if (!project)
    throw new Error('字幕项目不存在或无权访问')
  if (!project.sentences || project.sentences.length === 0)
    throw new Error('没有字幕内容，无法导出')
  if (project.status !== 'subtitle_editing')
    throw new Error('项目状态不是"字幕编辑"，无法导出')

  await updateSubtitleProjectStatus(project.id, 'exporting')

  try {
    // 1. 生成 ASS 内容
    const styleConfig: SubtitleStyleConfig = project.styleConfig ?? {
      templateId: 'cinema',
      fontSize: 24,
      fontColor: '#FFFFFF',
      outlineColor: '#000000',
      outlineWidth: 2,
      position: 'bottom',
      marginV: 30,
      bold: false,
    }
    const assContent = sentencesToAss(project.sentences, styleConfig)

    // 2. 获取原始视频文件路径
    const file = await getUploadedFileById(project.videoFileId)
    if (!file || file.accountId !== accountId)
      throw new Error('原始视频文件不存在或不属于当前用户')

    const videoPath = file.publicUrl.startsWith('/') || file.publicUrl.startsWith('./')
      ? `${config.storageRoot}/${file.storagePath}`
      : file.publicUrl

    // 3. FFmpeg 烧录字幕
    const { outputPath } = await burnSubtitlesToVideo(videoPath, assContent, config.storageRoot)

    // 4. 上传导出视频到存储
    const videoBuffer = await Bun.file(outputPath).arrayBuffer()
    const exportedVideoUrl = await deps.storage.uploadGenerated(
      Buffer.from(videoBuffer),
      `subtitle/export_${project.id}.mp4`,
      'video/mp4',
    )

    // 清理本地临时文件
    try {
      await Bun.file(outputPath).delete()
    }
    catch {}

    // 5. 创建 generation_record
    const exportRecord = await createGenerationRecord({
      accountId,
      taskId: `export_${Date.now()}_${project.id}`,
      traceId: crypto.randomUUID(),
      model: 'ffmpeg-burn',
      category: 'subtitle',
      status: 'succeeded',
      inputParams: { projectId: project.id } as Record<string, unknown>,
    })

    // 6. 更新项目状态
    await updateSubtitleExport(project.id, exportRecord.id, exportedVideoUrl)
    await updateSubtitleProjectStatus(project.id, 'completed')

    // 7. SSE 通知
    await notifyGenerationStatus({
      accountId,
      recordId: exportRecord.id,
      status: 'succeeded',
      category: 'subtitle',
      model: 'ffmpeg-burn',
      taskId: exportRecord.taskId,
      traceId: exportRecord.traceId ?? undefined,
    })
  }
  catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    await updateSubtitleProjectStatus(project.id, 'failed', { errorMessage: errorMsg })
    throw err
  }
}
