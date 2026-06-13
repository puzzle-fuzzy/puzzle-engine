import type { WorkerConfig } from './config'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  updateCanvasLocation,
  updateCanvasProject,
} from '@excuse/db'
import {
  AssetStorage,
  getModelById,
} from '@excuse/provider'
import {
  createDashScopeClient,
  getImageModel,
  loadRunnableCanvasProject,
} from './canvas-execution'
import { generateCanvasImageAsset } from './canvas-image-assets'

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

      const generated = await generateCanvasImageAsset({
        assetId: refAsset.id,
        imageModel,
        imageModelConfig,
        prompt,
        subDir: `canvas/${location.id}`,
        prefix: 'ref',
        errorMessage: '场景参考图生成失败',
        client,
        storage,
      })
      if (!generated)
        continue

      await updateCanvasLocation(location.id, { referenceImageUrl: generated.publicUrl })
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
