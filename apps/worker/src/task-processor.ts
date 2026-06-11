import type { CostDetail, GenerationCategory, GenerationNotifyPayload, GenerationStatus, OutputResult } from '@excuse/shared'
import type { WorkerConfig } from './config'
import { calculateCost } from '@excuse/billing'
import {
  listCanvasShotsByProject,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { AssetStorage, DashScopeClient, getModelById } from '@excuse/provider'
import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-processor')

/**
 * 单条 generation record 的处理结果
 */
export type TaskResult
  = | { action: 'completed', taskId: string }
    | { action: 'skipped', taskId: string, reason: string }
    | { action: 'ignored', taskId: string, status: string }

/**
 * 可注入的外部依赖（测试时替换）
 */
export interface TaskProcessorDeps {
  queryTask: (taskId: string) => Promise<{
    status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
    output?: Record<string, unknown>
    errorMessage?: string
  }>
  downloadAndMap: (urls: string[], subDir: string, prefix: string) => Promise<string[]>
  markGenerationFailed: (id: string, message: string) => Promise<void>
  markGenerationSucceeded: (id: string, output: OutputResult, cost?: CostDetail) => Promise<void>
  markGenerationProcessing: (id: string) => Promise<void>
  notifyGenerationStatus: (payload: GenerationNotifyPayload) => Promise<void>
}

/**
 * 创建任务处理器
 *
 * @param config Worker 配置
 * @param deps 可选的外部依赖注入（测试时使用）
 */
export function createTaskProcessor(config: WorkerConfig, deps?: Partial<TaskProcessorDeps>) {
  // 生产环境：用真实依赖
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  const queryTask = deps?.queryTask ?? ((id: string) => client.queryTask(id))
  const downloadAndMap = deps?.downloadAndMap ?? ((urls, subDir, prefix) => storage.downloadAndMap(urls, subDir, prefix))
  const fail = deps?.markGenerationFailed ?? markGenerationFailed
  const succeed = deps?.markGenerationSucceeded ?? markGenerationSucceeded
  const processing = deps?.markGenerationProcessing ?? markGenerationProcessing
  const notify = deps?.notifyGenerationStatus ?? notifyGenerationStatus

  return { processTask }

  /**
   * 处理单条待轮询的任务
   */
  async function processTask(record: {
    id: string
    accountId: string
    taskId: string | null
    model: string
    status: string
    category: GenerationCategory
    createdAt: Date
    inputParams: Record<string, unknown> | null
    cost: CostDetail | null
  }): Promise<TaskResult> {
    const inputParams = record.inputParams ?? {}
    const canvasMeta = inputParams.source === 'canvas'
      ? { projectId: String(inputParams.projectId), shotId: String(inputParams.shotId) }
      : undefined
    const taskId = record.taskId
    if (!taskId) {
      return { action: 'skipped', taskId: record.id, reason: 'no taskId' }
    }

    // ── 超时检测 ──────────────────────────────────────
    const elapsed = Date.now() - new Date(record.createdAt).getTime()
    if (elapsed > config.staleTimeoutMs) {
      await fail(record.id, 'Task timed out (>4h)')
      await notify({
        accountId: record.accountId,
        recordId: record.id,
        status: 'failed' as GenerationStatus,
        category: record.category,
        model: record.model,
        taskId,
        errorMessage: 'Task timed out (>4h)',
      })
      return { action: 'completed', taskId }
    }

    // ── 查询 DashScope 任务状态 ───────────────────────
    const taskStatus = await queryTask(taskId)

    switch (taskStatus.status) {
      // ── 成功：下载 + 计费 + 更新 ────────────────────
      case 'SUCCEEDED': {
        const videoUrl = extractVideoUrl(taskStatus.output)
        const savedUrls = videoUrl
          ? await downloadAndMap([videoUrl], taskId, 'video')
          : []

        const modelConfig = getModelById(record.model)
        // 从 DashScope 返回结果中提取实际视频时长
        const inputDuration = inputParams.duration
        const actualVideoDuration = extractVideoDuration(taskStatus.output) || (typeof inputDuration === 'number' ? inputDuration : 5)
        const actualCost = modelConfig
          ? calculateCost(modelConfig, inputParams, {
              videoDuration: actualVideoDuration,
            })
          : record.cost

        const output = {
          ...(taskStatus.output || {}),
          type: 'video' as const,
          savedUrls,
          originalUrl: videoUrl,
        }

        await succeed(record.id, output as OutputResult, actualCost ?? undefined)

        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'succeeded' as GenerationStatus,
          category: record.category,
          model: record.model,
          taskId,
          outputResult: output as OutputResult,
          cost: actualCost ?? undefined,
          canvasMeta,
        })

        // Update canvas shot status + videoUrl
        if (canvasMeta) {
          await updateCanvasShot(canvasMeta.shotId, {
            status: 'completed',
            videoUrl: savedUrls[0] || undefined,
          }).catch(err => logger.error({ err, shotId: canvasMeta.shotId }, 'Failed to update canvas shot'))
          await checkProjectCompletion(canvasMeta.projectId).catch(err =>
            logger.error({ err, projectId: canvasMeta.projectId }, 'Failed to check project completion'),
          )
        }

        return { action: 'completed', taskId }
      }

      // ── 失败 ────────────────────────────────────────
      case 'FAILED': {
        const errMsg = taskStatus.errorMessage || 'DashScope task failed'
        await fail(record.id, errMsg)
        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'failed' as GenerationStatus,
          category: record.category,
          model: record.model,
          taskId,
          errorMessage: errMsg,
          canvasMeta,
        })

        // Update canvas shot status
        if (canvasMeta) {
          await updateCanvasShot(canvasMeta.shotId, {
            status: 'failed',
            errorMessage: errMsg,
          }).catch(err => logger.error({ err, shotId: canvasMeta.shotId }, 'Failed to update canvas shot'))
          await checkProjectCompletion(canvasMeta.projectId).catch(err =>
            logger.error({ err, projectId: canvasMeta.projectId }, 'Failed to check project completion'),
          )
        }

        return { action: 'completed', taskId }
      }

      // ── 仍在处理中 ──────────────────────────────────
      case 'PENDING':
      case 'RUNNING': {
        if (record.status === 'pending') {
          await processing(record.id)
        }
        return { action: 'skipped', taskId, reason: `still ${taskStatus.status}` }
      }

      default:
        return { action: 'ignored', taskId, status: taskStatus.status }
    }
  }
}

// ── 工具函数 ────────────────────────────────────────────

export function extractVideoUrl(output: Record<string, unknown> | undefined): string | undefined {
  if (!output)
    return undefined
  const videoUrl = output.video_url
  if (typeof videoUrl === 'string')
    return videoUrl
  const results = output.results
  if (Array.isArray(results) && results.length > 0) {
    const first = results[0] as Record<string, unknown>
    const url = first.url || first.b64_image
    if (typeof url === 'string')
      return url
  }
  return undefined
}

export function extractVideoDuration(output: Record<string, unknown> | undefined): number | undefined {
  if (!output)
    return undefined
  const duration = output.video_duration ?? output.duration
  if (typeof duration === 'number')
    return duration
  return undefined
}

/**
 * Check if all canvas shots for a project have finished (no 'generating' shots left).
 * If so, update the project status to 'completed'.
 */
async function checkProjectCompletion(projectId: string) {
  const shots = await listCanvasShotsByProject(projectId)
  const stillGenerating = shots.some(s => s.status === 'generating')
  if (!stillGenerating && shots.length > 0) {
    await updateCanvasProject(projectId, { status: 'completed' })
  }
}
