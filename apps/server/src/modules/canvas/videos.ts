import { submitCanvasShotVideo, submitShotVideoEntity } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  getCanvasShotById,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  resetCanvasShotToDraft,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { getProjectDetail } from './service-crud'
import { createClient, getVideoModel, notifyNode } from './service-helpers'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function generateVideos(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const accountId = detail.project.accountId
  const client = createClient(config)

  if (runId)
    await markPipelineRunRunning(runId)

  await updateCanvasProject(projectId, { status: 'generating' })

  let hasAnyVideo = false

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running', undefined, undefined, runId)

    // ── 为镜头视频创建 canvas_asset ──────────────────
    const shotVideoAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      pipelineRunId: runId ?? undefined,
      model: getVideoModel(detail.project.modelPreferencesJson, []),
    })
    await markCanvasAssetRunning(shotVideoAsset.id)

    try {
      await submitShotVideoEntity({
        projectId,
        accountId,
        shotId: shot.id,
        assetId: shotVideoAsset.id,
        shot,
        characters: detail.characters,
        locations: detail.locations,
        modelPreferences: detail.project.modelPreferencesJson,
        client,
      })
      hasAnyVideo = true
    }
    catch (error) {
      const message = getErrorMessage(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
      // ── 标记视频资产失败 ──────────────────────────
      await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
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
  const shotVideoAsset = await createCanvasAsset({
    accountId: detail.project.accountId,
    projectId: shot.projectId,
    category: 'shotVideo',
    targetEntityType: 'shot',
    targetEntityId: shot.id,
    model,
  })
  await markCanvasAssetRunning(shotVideoAsset.id)

  try {
    await submitCanvasShotVideo({
      accountId: detail.project.accountId,
      projectId: shot.projectId,
      shotId,
      assetId: shotVideoAsset.id,
      model,
      videoPrompt: shot.videoPrompt!,
      negativePrompt: shot.negativePrompt,
      duration: shot.duration,
      referenceUrls,
      client,
      estimatedCost: true,
    })
  }
  catch (error) {
    const message = getErrorMessage(error)
    await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
    await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
    notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'failed', undefined, message)
    throw error
  }
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
    const shotVideoAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'shotVideo',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      model,
    })
    await markCanvasAssetRunning(shotVideoAsset.id)

    try {
      await submitCanvasShotVideo({
        accountId,
        projectId,
        shotId: shot.id,
        assetId: shotVideoAsset.id,
        model,
        videoPrompt: shot.videoPrompt!,
        negativePrompt: shot.negativePrompt,
        duration: shot.duration,
        referenceUrls,
        client,
        estimatedCost: true,
      })
    }
    catch (error) {
      const message = getErrorMessage(error)
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: message })
      await markCanvasAssetFailed(shotVideoAsset.id, message).catch(() => {})
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, message)
    }
  }
}
