import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  getCanvasProjectDetail,
  getCanvasShotById,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  resetCanvasShotToDraft,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import {
  getModelById as getProviderModelById,
  mergeWithDefaults as mergeProviderWithDefaults,
  validateModelParameters as validateProviderModelParameters,
} from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { createClient, getVideoModel, notifyNode } from './service-helpers'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

interface PrepareCanvasVideoParamDeps {
  getModelById: typeof getProviderModelById
  mergeWithDefaults: typeof mergeProviderWithDefaults
  validateModelParameters: typeof validateProviderModelParameters
}

const providerParamDeps: PrepareCanvasVideoParamDeps = {
  getModelById: getProviderModelById,
  mergeWithDefaults: mergeProviderWithDefaults,
  validateModelParameters: validateProviderModelParameters,
}

type CanvasVideoResolution = '720P' | '1080P'

export interface CanvasVideoParameters extends Record<string, unknown> {
  prompt: string
  resolution: CanvasVideoResolution
  duration: number
  negative_prompt?: string
}

export interface CanvasVideoGenerationInput extends CanvasVideoParameters {
  source: 'canvas'
  projectId: string
  shotId: string
}

function parseCanvasVideoParameters(value: Record<string, unknown>): CanvasVideoParameters {
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

export function prepareCanvasVideoParams(
  model: string,
  shot: { videoPrompt: string, negativePrompt?: string | null, duration: number },
  deps: PrepareCanvasVideoParamDeps = providerParamDeps,
) {
  const modelConfig = deps.getModelById(model)
  if (!modelConfig)
    throw new Error(`未知视频模型：${model}`)

  const declaredParams = new Set(modelConfig.parameters.map(p => p.name))
  const params: CanvasVideoParameters = {
    prompt: shot.videoPrompt.slice(0, 2500),
    resolution: '720P',
    duration: shot.duration,
  }

  if (declaredParams.has('negative_prompt') && shot.negativePrompt) {
    params.negative_prompt = shot.negativePrompt
  }

  const validation = deps.validateModelParameters(modelConfig, params)
  if (!validation.valid) {
    const message = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`视频参数校验失败：${message}`)
  }

  return {
    modelConfig,
    params: parseCanvasVideoParameters(deps.mergeWithDefaults(modelConfig, params)),
  }
}

export async function generateVideos(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const accountId = detail.project.accountId
  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  if (runId)
    await markPipelineRunRunning(runId)

  await updateCanvasProject(projectId, { status: 'generating' })

  let hasAnyVideo = false

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running', undefined, undefined, runId)

    try {
      const charRefUrls = shot.characterIdsJson
        .map(id => characterMap.get(id)?.referenceImageUrl)
        .filter(Boolean) as string[]
      const locRefUrl = shot.locationId
        ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
        : null
      const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

      const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
      const { params: videoParams } = prepareCanvasVideoParams(model, {
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
        await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
        notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, submitResult.error, runId)
        continue
      }

      await updateCanvasShot(shot.id, {
        videoTaskId: submitResult.taskId,
        status: 'generating',
      })
      hasAnyVideo = true

      const usedModelConfig = getProviderModelById(submitResult.model)!
      const inputParams: CanvasVideoGenerationInput = { source: 'canvas', projectId, shotId: shot.id, ...videoParams }
      const cost = calculateCost(usedModelConfig, inputParams)
      await createGenerationRecord({
        accountId,
        taskId: submitResult.taskId!,
        model: submitResult.model,
        category: 'video',
        status: 'processing',
        inputParams,
        cost,
      })
    }
    catch (error) {
      const message = getErrorMessage(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, message, runId)
    }
  }

  if (hasAnyVideo) {
    await updateCanvasProject(projectId, { status: 'generating' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'videos', shotsSubmitted: detail.shots.filter(s => s.videoPrompt).length })
  }
  else {
    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    if (runId)
      await markPipelineRunFailed(runId, '所有视频提交失败')
  }

  return getProjectDetail(projectId)
}

export async function retryShotVideo(shotId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const shot = await getCanvasShotById(shotId)
  if (!shot)
    throw new Error('镜头不存在')
  if (shot.status !== 'failed')
    throw new Error('只能重试失败的镜头')

  await resetCanvasShotToDraft(shotId)

  const detail = await getCanvasProjectDetail(shot.projectId)
  if (!detail)
    throw new Error('项目不存在')

  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  await updateCanvasProject(shot.projectId, { status: 'generating' })

  notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'running')

  const charRefUrls = shot.characterIdsJson
    .map(id => characterMap.get(id)?.referenceImageUrl)
    .filter(Boolean) as string[]
  const locRefUrl = shot.locationId
    ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
    : null
  const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

  const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
  const { params: videoParams } = prepareCanvasVideoParams(model, {
    videoPrompt: shot.videoPrompt!,
    negativePrompt: shot.negativePrompt,
    duration: shot.duration,
  })

  const submitResult = await client.submitVideoTaskWithFallback(
    model,
    videoParams,
    referenceUrls.length > 0 ? referenceUrls : undefined,
  )

  if (!submitResult.success || !submitResult.taskId) {
    await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
    notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'failed', undefined, submitResult.error)
    throw new Error(submitResult.error)
  }

  await updateCanvasShot(shot.id, { videoTaskId: submitResult.taskId, status: 'generating' })

  const usedModelConfig = getProviderModelById(submitResult.model)!
  const inputParams: CanvasVideoGenerationInput = { source: 'canvas', projectId: shot.projectId, shotId, ...videoParams }
  const cost = calculateCost(usedModelConfig, inputParams)
  await createGenerationRecord({
    accountId: detail.project.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    category: 'video',
    status: 'processing',
    inputParams,
    cost: { ...cost, estimated: true },
  })
}

export async function retryFailedShots(projectId: string, accountId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const failedShots = detail.shots.filter(s => s.status === 'failed')
  if (failedShots.length === 0)
    throw new Error('没有失败的镜头可以重试')

  await updateCanvasProject(projectId, { status: 'generating' })

  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  for (const shot of failedShots) {
    await resetCanvasShotToDraft(shot.id)
    notifyNode(accountId, projectId, 'shot', shot.id, 'running')

    const charRefUrls = shot.characterIdsJson
      .map((id: string) => characterMap.get(id)?.referenceImageUrl)
      .filter(Boolean) as string[]
    const locRefUrl = shot.locationId
      ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
      : null
    const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

    const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
    const { params: videoParams } = prepareCanvasVideoParams(model, {
      videoPrompt: shot.videoPrompt!,
      negativePrompt: shot.negativePrompt,
      duration: shot.duration,
    })

    const submitResult = await client.submitVideoTaskWithFallback(
      model,
      videoParams,
      referenceUrls.length > 0 ? referenceUrls : undefined,
    )

    if (!submitResult.success || !submitResult.taskId) {
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, submitResult.error)
      continue
    }

    await updateCanvasShot(shot.id, { videoTaskId: submitResult.taskId, status: 'generating' })

    const usedModelConfig = getProviderModelById(submitResult.model)!
    const inputParams: CanvasVideoGenerationInput = { source: 'canvas', projectId, shotId: shot.id, ...videoParams }
    const cost = calculateCost(usedModelConfig, inputParams)
    await createGenerationRecord({
      accountId,
      taskId: submitResult.taskId,
      model: submitResult.model,
      category: 'video',
      status: 'processing',
      inputParams,
      cost: { ...cost, estimated: true },
    })
  }
}
