import type { WorkerConfig } from './config'
import { submitCanvasShotVideo } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import {
  createDashScopeClient,
  getVideoModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

export interface CanvasVideosResult extends Record<string, unknown> {
  phase: 'videos'
  projectId: string
  shotsSubmitted: number
  shotsSkipped: number
  shotsFailed: number
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

      await submitCanvasShotVideo({
        accountId,
        projectId,
        shotId: shot.id,
        assetId: shotVideoAsset.id,
        model,
        videoPrompt: shot.videoPrompt,
        negativePrompt: shot.negativePrompt,
        duration: shot.duration,
        referenceUrls,
        client,
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
