import type { GenerationInputParams } from '@excuse/db'
import type { ValidatedModelParameters } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'
import {
  bindCanvasAssetTaskId,
  createCanvasAsset,
  createGenerationRecord,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'
import {
  createDashScopeClient,
  getVideoModel,
  loadRunnableCanvasProject,
} from './canvas-execution'
import type { WorkerConfig } from './config'

type CanvasVideoResolution = '720P' | '1080P'

export interface CanvasVideosResult extends Record<string, unknown> {
  phase: 'videos'
  projectId: string
  shotsSubmitted: number
  shotsSkipped: number
  shotsFailed: number
}

interface CanvasVideoParameters {
  prompt: string
  resolution: CanvasVideoResolution
  duration: number
  negative_prompt?: string
}

export async function executeCanvasVideos(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasVideosResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  const client = createDashScopeClient(workerConfig)
  const characterMap = new Map(detail.characters.map(character => [character.id, character]))
  const locationMap = new Map(detail.locations.map(location => [location.id, location]))
  let shotsSubmitted = 0
  let shotsSkipped = 0
  let shotsFailed = 0

  await updateCanvasProject(projectId, { status: 'generating' })

  for (const shot of detail.shots) {
    if (!shot.videoPrompt) {
      shotsSkipped += 1
      continue
    }

    const pendingModel = getVideoModel(project.modelPreferencesJson, [])
    const shotVideoAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      pipelineRunId: runId ?? undefined,
      model: pendingModel,
    })
    await markCanvasAssetRunning(shotVideoAsset.id)

    try {
      const characterReferenceUrls = shot.characterIdsJson
        .map(id => characterMap.get(id)?.referenceImageUrl)
        .filter((url): url is string => Boolean(url))
      const locationReferenceUrl = shot.locationId
        ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
        : null
      const referenceUrls = [...characterReferenceUrls, ...(locationReferenceUrl ? [locationReferenceUrl] : [])]
      const model = getVideoModel(project.modelPreferencesJson, referenceUrls)
      const videoParams = prepareCanvasVideoParams(model, {
        videoPrompt: shot.videoPrompt,
        negativePrompt: shot.negativePrompt,
        duration: shot.duration,
      })

      const submitResult = await client.submitVideoTaskWithFallback(
        model,
        videoParams,
        referenceUrls.length > 0 ? referenceUrls : undefined,
      )

      if (!submitResult.success || !submitResult.taskId) {
        const errorMessage = submitResult.error ?? '视频提交失败'
        await updateCanvasShot(shot.id, { status: 'failed', errorMessage })
        await markCanvasAssetFailed(shotVideoAsset.id, errorMessage).catch(() => {})
        shotsFailed += 1
        continue
      }

      await bindCanvasAssetTaskId(shotVideoAsset.id, submitResult.taskId)
      await updateCanvasShot(shot.id, {
        videoTaskId: submitResult.taskId,
        status: 'generating',
      })

      const usedModelConfig = getModelById(submitResult.model)!
      const inputParams: GenerationInputParams = {
        source: 'canvas',
        projectId,
        shotId: shot.id,
        ...videoParams,
      }
      const cost = calculateCost(usedModelConfig, extractBillingParams(videoParams))
      await createGenerationRecord({
        accountId,
        taskId: submitResult.taskId,
        model: submitResult.model,
        category: 'video',
        status: 'processing',
        inputParams,
        cost,
      })
      shotsSubmitted += 1
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage })
      await markCanvasAssetFailed(shotVideoAsset.id, errorMessage).catch(() => {})
      shotsFailed += 1
    }
  }

  await updateCanvasProject(projectId, {
    status: shotsSubmitted > 0 ? 'generating' : 'prompts_ready',
  })

  return {
    phase: 'videos',
    projectId,
    shotsSubmitted,
    shotsSkipped,
    shotsFailed,
  }
}

function prepareCanvasVideoParams(
  model: string,
  shot: { videoPrompt: string, negativePrompt?: string | null, duration: number },
): ValidatedModelParameters {
  const modelConfig = getModelById(model)
  if (!modelConfig)
    throw new Error(`未知视频模型：${model}`)

  const declaredParams = new Set(modelConfig.parameters.map(parameter => parameter.name))
  const rawParams: Record<string, unknown> = {
    prompt: shot.videoPrompt.slice(0, 2500),
    resolution: '720P',
    duration: shot.duration,
  }

  if (declaredParams.has('negative_prompt') && shot.negativePrompt)
    rawParams.negative_prompt = shot.negativePrompt

  const validationResult = validateAndMerge(modelConfig, rawParams)
  if (!validationResult.ok) {
    const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`视频参数校验失败：${detail}`)
  }

  parseCanvasVideoParameters(validationResult.params)
  return validationResult.params
}

function parseCanvasVideoParameters(value: ValidatedModelParameters): CanvasVideoParameters {
  const prompt = value.prompt
  if (typeof prompt !== 'string' || prompt.length === 0)
    throw new Error('视频参数校验失败：prompt 必须是非空字符串')

  const resolution = value.resolution
  if (resolution !== '720P' && resolution !== '1080P')
    throw new Error('视频参数校验失败：resolution 必须是 720P 或 1080P')

  const duration = value.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0)
    throw new Error('视频参数校验失败：duration 必须是正数')

  const negativePrompt = value.negative_prompt
  if (negativePrompt !== undefined && typeof negativePrompt !== 'string')
    throw new Error('视频参数校验失败：negative_prompt 必须是字符串')

  return {
    prompt,
    resolution,
    duration,
    ...(negativePrompt !== undefined && { negative_prompt: negativePrompt }),
  }
}
