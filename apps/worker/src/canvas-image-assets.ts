import type { CanvasAssetOutput } from '@excuse/db'
import type { AssetStorage, DashScopeClient } from '@excuse/provider'
import {
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
} from '@excuse/db'
import { getModelById, validateAndMerge } from '@excuse/provider'

export interface GenerateCanvasImageAssetInput {
  assetId: string
  imageModel: string
  imageModelConfig: NonNullable<ReturnType<typeof getModelById>>
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

export async function generateCanvasImageAsset(
  input: GenerateCanvasImageAssetInput,
): Promise<GeneratedCanvasImageAsset | null> {
  const validation = validateAndMerge(input.imageModelConfig, {
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
