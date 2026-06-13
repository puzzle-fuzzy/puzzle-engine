import type { CanvasAssetOutput } from '@excuse/db'
import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from './continuity'
import {
  createCanvasAsset,
  createContinuityReport,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  setCanvasAssetActive,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
import { validateShotContinuity } from './continuity'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, notifyNode } from './service-helpers'

export async function checkContinuity(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  // ── 为连续性检查创建 canvas_asset ──────────────────
  const continuityAsset = await createCanvasAsset({
    accountId,
    projectId,
    category: 'continuityReport',
    targetEntityType: 'project',
    targetEntityId: projectId,
    pipelineRunId: runId ?? undefined,
  })

  try {
    // ── 标记资产为运行状态 ──────────────────────────
    await markCanvasAssetRunning(continuityAsset.id)

    const normalizedShots: NormalizedShot[] = detail.shots.map((s): NormalizedShot => ({
      id: s.id,
      shotIndex: s.shotIndex,
      locationId: s.locationId,
      characterIds: (s.characterIdsJson ?? []) as string[],
      narrative: s.narrative,
      duration: s.duration,
      camera: s.cameraJson,
      continuity: s.continuityJson,
      timeline: s.timelineJson ?? undefined,
      environment: s.environmentJson ?? undefined,
    }))

    const normalizedCharacters: NormalizedCharacter[] = detail.characters.map(c => ({
      id: c.id,
      name: c.name,
      identityPrompt: c.identityPrompt ?? '',
      negativePrompt: c.negativePrompt ?? '',
    }))

    const normalizedLocations: NormalizedLocation[] = detail.locations.map((l) => {
      const cameraRules = l.profileJson?.cameraRules
      return {
        id: l.id,
        name: l.name,
        scenePrompt: l.scenePrompt ?? '',
        negativePrompt: l.negativePrompt ?? '',
        cameraRules: cameraRules ?? { axisDirection: '', allowedAngles: [] as string[], forbiddenAngles: [] as string[] },
      }
    })

    const issues = validateShotContinuity({
      shots: normalizedShots,
      characters: normalizedCharacters,
      locations: normalizedLocations,
    })

    await createContinuityReport({
      projectId,
      issuesJson: issues,
    })

    // ── 标记连续性资产成功 + 设为活跃 ──────────────────
    const outputJson: CanvasAssetOutput = { type: 'json', data: { issuesCount: issues.length, issues } }
    await markCanvasAssetSucceeded(continuityAsset.id, outputJson)
    await setCanvasAssetActive(continuityAsset.id)

    notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues }, undefined, runId)
    await updateCanvasProject(projectId, { status: 'continuity_checked' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'continuity', issuesFound: issues.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    // ── 标记连续性资产失败 ──────────────────────────────
    await markCanvasAssetFailed(continuityAsset.id, errorMessage).catch(() => {})
    notifyNode(accountId, projectId, 'continuity', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}

export async function rebuildShotPrompts(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const characterMap = new Map(detail.characters.map(c => [c.id, c]))
    const locationMap = new Map(detail.locations.map(l => [l.id, l]))

    for (const shot of detail.shots) {
      const shotCharacters = shot.characterIdsJson
        .map(id => characterMap.get(id))
        .filter(Boolean) as typeof detail.characters

      const shotLocation = shot.locationId ? locationMap.get(shot.locationId) : undefined

      if (!shotLocation)
        continue

      // ── 为每个镜头的视频提示词创建 canvas_asset ────
      const promptAsset = await createCanvasAsset({
        accountId,
        projectId,
        category: 'videoPrompt',
        targetEntityType: 'shot',
        targetEntityId: shot.id,
        pipelineRunId: runId ?? undefined,
      })

      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(promptAsset.id)

      const { videoPrompt, negativePrompt } = buildShotVideoPrompt({
        shot: {
          id: shot.id,
          shotIndex: shot.shotIndex,
          locationId: shot.locationId,
          characterIds: shot.characterIdsJson,
          narrative: shot.narrative,
          camera: shot.cameraJson,
          continuity: shot.continuityJson,
          timeline: shot.timelineJson ?? undefined,
          environment: shot.environmentJson ?? undefined,
          duration: shot.duration,
        },
        characters: shotCharacters.map(c => ({
          id: c.id,
          name: c.name,
          identityPrompt: c.identityPrompt ?? '',
          negativePrompt: c.negativePrompt ?? '',
        })),
        location: {
          id: shotLocation.id,
          name: shotLocation.name,
          scenePrompt: shotLocation.scenePrompt ?? '',
          negativePrompt: shotLocation.negativePrompt ?? '',
          cameraRules: shotLocation.profileJson?.cameraRules ?? { axisDirection: '', allowedAngles: [] as string[], forbiddenAngles: [] as string[] },
        },
        timeline: shot.timelineJson ?? undefined,
        environment: shot.environmentJson ?? undefined,
      })

      await updateCanvasShot(shot.id, {
        videoPrompt,
        negativePrompt,
        status: 'ready',
      })

      // ── 标记视频提示词资产成功 + 设为活跃 ────────────
      const outputJson: CanvasAssetOutput = { type: 'text', text: videoPrompt }
      await markCanvasAssetSucceeded(promptAsset.id, outputJson)
      await setCanvasAssetActive(promptAsset.id)
    }

    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    notifyNode(accountId, projectId, 'prompts', projectId, 'completed', undefined, undefined, runId)
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'rebuild' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, projectId, 'rebuild', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}
