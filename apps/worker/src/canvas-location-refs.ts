import type { CanvasAssetOutput } from '@excuse/db'
import type { WorkerConfig } from './config'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasLocation,
  updateCanvasProject,
} from '@excuse/db'
import {
  AssetStorage,
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import {
  createDashScopeClient,
  getImageModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

export interface CanvasLocationRefsResult extends Record<string, unknown> {
  phase: 'locationRefs'
  projectId: string
  locationsProcessed: number
  locationsSkipped: number
  locationsFailed: number
  refsCreated: number
}

export async function executeCanvasLocationRefs(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasLocationRefsResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  const imageModel = getImageModel(project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  const client = createDashScopeClient(workerConfig)
  const storage = new AssetStorage({ storageRoot: workerConfig.storageRoot, oss: workerConfig.oss })
  let locationsProcessed = 0
  let locationsSkipped = 0
  let locationsFailed = 0
  let refsCreated = 0

  for (const location of detail.locations) {
    if (location.locked || !location.scenePrompt || location.referenceImageUrl) {
      locationsSkipped += 1
      continue
    }

    locationsProcessed += 1
    const prompt = `${location.scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`

    const refAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'locationRef',
      targetEntityType: 'location',
      targetEntityId: location.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt, size: '2048*2048', n: 1 },
    })

    try {
      await markCanvasAssetRunning(refAsset.id)

      const validation = validateAndMerge(imageModelConfig, {
        prompt,
        size: '2048*2048',
        n: 1,
      })
      if (!validation.ok) {
        const detail = validation.errors.map(error => `${error.field}: ${error.message}`).join('; ')
        throw new Error(`参数校验失败：${detail}`)
      }

      const result = await client.generateImage(imageModel, validation.params)
      if (result.type === 'failed')
        throw new Error(result.error || '场景参考图生成失败')

      const urls = result.output.urls
      if (!Array.isArray(urls) || urls.length === 0)
        continue

      const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${location.id}`, 'ref')
      const publicUrl = savedUrls[0] || urls[0]
      await updateCanvasLocation(location.id, { referenceImageUrl: publicUrl })

      const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
      await markCanvasAssetSucceeded(refAsset.id, outputJson, publicUrl, savedUrls[0] ?? undefined, urls[0], undefined)
      await setCanvasAssetActive(refAsset.id)
      refsCreated += 1
    }
    catch (error) {
      locationsFailed += 1
      const errorMessage = error instanceof Error ? error.message : String(error)
      await markCanvasAssetFailed(refAsset.id, errorMessage).catch(() => {})
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })

  return {
    phase: 'locationRefs',
    projectId,
    locationsProcessed,
    locationsSkipped,
    locationsFailed,
    refsCreated,
  }
}
