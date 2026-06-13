import type { GenerationInputParams } from '@excuse/db'
import type { DashScopeClient, ValidatedModelParameters } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'
import {
  bindCanvasAssetTaskId,
  createGenerationRecord,
  updateCanvasShot,
} from '@excuse/db'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'

type CanvasVideoResolution = '720P' | '1080P'

export interface CanvasVideoSubmitInput {
  accountId: string
  projectId: string
  shotId: string
  assetId: string
  model: string
  videoPrompt: string
  negativePrompt?: string | null
  duration: number
  referenceUrls: string[]
  client: DashScopeClient
}

export interface CanvasVideoSubmitResult {
  taskId: string
  model: string
}

interface CanvasVideoParameters {
  prompt: string
  resolution: CanvasVideoResolution
  duration: number
  negative_prompt?: string
}

export async function submitCanvasShotVideo(
  input: CanvasVideoSubmitInput,
): Promise<CanvasVideoSubmitResult> {
  const videoParams = prepareCanvasVideoParams(input.model, {
    videoPrompt: input.videoPrompt,
    negativePrompt: input.negativePrompt,
    duration: input.duration,
  })

  const submitResult = await input.client.submitVideoTaskWithFallback(
    input.model,
    videoParams,
    input.referenceUrls.length > 0 ? input.referenceUrls : undefined,
  )

  if (!submitResult.success || !submitResult.taskId)
    throw new Error(submitResult.error ?? '视频提交失败')

  await bindCanvasAssetTaskId(input.assetId, submitResult.taskId)
  await updateCanvasShot(input.shotId, {
    videoTaskId: submitResult.taskId,
    status: 'generating',
  })

  const usedModelConfig = getModelById(submitResult.model)!
  const inputParams: GenerationInputParams = {
    source: 'canvas',
    projectId: input.projectId,
    shotId: input.shotId,
    ...videoParams,
  }
  const cost = calculateCost(usedModelConfig, extractBillingParams(videoParams))
  await createGenerationRecord({
    accountId: input.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    category: 'video',
    status: 'processing',
    inputParams,
    cost,
  })

  return {
    taskId: submitResult.taskId,
    model: submitResult.model,
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
