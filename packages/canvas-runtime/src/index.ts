import type { CanvasAssetOutput, GenerationInputParams } from '@excuse/db'
import type { AssetStorage, DashScopeClient, ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import { calculateCost } from '@excuse/billing'
import {
  bindCanvasAssetTaskId,
  createCanvasAsset,
  createGenerationRecord,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasShot,
} from '@excuse/db'
import {
  getModelById as getProviderModelById,
  validateAndMerge as validateProviderAndMerge,
} from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'

type CreateCanvasAssetInput = Parameters<typeof createCanvasAsset>[0]
type CanvasVideoResolution = '720P' | '1080P'

export interface RunCanvasAssetStepInput<T> {
  asset: CreateCanvasAssetInput
  execute: (assetId: string) => Promise<{ result: T, output: CanvasAssetOutput }>
  setActive?: boolean
}

export interface GenerateCanvasImageAssetInput {
  assetId: string
  imageModel: string
  imageModelConfig: ModelConfig
  prompt: string
  subDir: string
  prefix: string
  errorMessage: string
  client: DashScopeClient
  storage: AssetStorage
}

export interface GeneratedCanvasImageAsset {
  publicUrl: string
  savedUrls: string[]
  providerUrls: string[]
}

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
  estimatedCost?: boolean
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

export interface PrepareCanvasVideoParamDeps {
  getModelById: typeof getProviderModelById
  validateAndMerge: typeof validateProviderAndMerge
}

const providerParamDeps: PrepareCanvasVideoParamDeps = {
  getModelById: getProviderModelById,
  validateAndMerge: validateProviderAndMerge,
}

export async function runCanvasAssetStep<T>(args: RunCanvasAssetStepInput<T>): Promise<T> {
  const asset = await createCanvasAsset(args.asset)

  try {
    await markCanvasAssetRunning(asset.id)
    const { result, output } = await args.execute(asset.id)
    await markCanvasAssetSucceeded(asset.id, output)
    if (args.setActive ?? true)
      await setCanvasAssetActive(asset.id)
    return result
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markCanvasAssetFailed(asset.id, errorMessage).catch(() => {})
    throw error
  }
}

export async function generateCanvasImageAsset(
  input: GenerateCanvasImageAssetInput,
): Promise<GeneratedCanvasImageAsset | null> {
  const validation = validateProviderAndMerge(input.imageModelConfig, {
    prompt: input.prompt,
    size: '2048*2048',
    n: 1,
  })
  if (!validation.ok) {
    const detail = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`参数校验失败：${detail}`)
  }

  const result = await input.client.generateImage(input.imageModel, validation.params)
  if (result.type === 'failed')
    throw new Error(result.error || input.errorMessage)

  const urls = result.output.urls
  if (!Array.isArray(urls) || urls.length === 0)
    return null

  const providerUrls = urls as string[]
  const savedUrls = await input.storage.downloadAndMap(providerUrls, input.subDir, input.prefix)
  const publicUrl = savedUrls[0] || providerUrls[0]!
  const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
  await markCanvasAssetSucceeded(input.assetId, outputJson, publicUrl, savedUrls[0] ?? undefined, providerUrls[0], undefined)
  await setCanvasAssetActive(input.assetId)

  return {
    publicUrl,
    savedUrls,
    providerUrls,
  }
}

export function getCanvasVideoModel(
  prefs: { videoModel?: string | null } | null | undefined,
  referenceUrls: string[],
): string {
  const base = prefs?.videoModel || 'happyhorse-1.0'
  const strippedBase = base.replace(/-r2v$|-t2v$|-i2v$/, '')
  return referenceUrls.length > 0 ? `${strippedBase}-r2v` : `${strippedBase}-t2v`
}

export async function submitCanvasShotVideo(
  input: CanvasVideoSubmitInput,
): Promise<CanvasVideoSubmitResult> {
  const { params: videoParams } = prepareCanvasVideoParams(input.model, {
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

  const usedModelConfig = getProviderModelById(submitResult.model)!
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
    cost: input.estimatedCost ? { ...cost, estimated: true } : cost,
  })

  return {
    taskId: submitResult.taskId,
    model: submitResult.model,
  }
}

export function prepareCanvasVideoParams(
  model: string,
  shot: { videoPrompt: string, negativePrompt?: string | null, duration: number },
  deps: PrepareCanvasVideoParamDeps = providerParamDeps,
): { modelConfig: ReturnType<typeof deps.getModelById>, params: ValidatedModelParameters } {
  const modelConfig = deps.getModelById(model)
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

  const validationResult = deps.validateAndMerge(modelConfig, rawParams)
  if (!validationResult.ok) {
    const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
    throw new Error(`视频参数校验失败：${detail}`)
  }

  parseCanvasVideoParameters(validationResult.params)
  return {
    modelConfig,
    params: validationResult.params,
  }
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

export * from './llm-helpers'
export * from './normalize'
export * from './phases/analysis'
export * from './phases/characters'
export * from './phases/continuity'
export * from './phases/locations'
export * from './phases/rebuild'
export * from './phases/storyboard'
