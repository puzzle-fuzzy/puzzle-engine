import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import type { CanvasAssetOutput } from '@excuse/db'
import { validateShotContinuity } from '@excuse/canvas-engine'
import {
  createCanvasAsset,
  createContinuityReport,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasProject,
} from '@excuse/db'

export interface CanvasContinuityResult extends Record<string, unknown> {
  phase: 'continuity'
  projectId: string
  issuesFound: number
}

export async function executeCanvasContinuity(projectId: string, runId?: string): Promise<CanvasContinuityResult> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  if (detail.project.status === 'generating')
    throw new Error('项目正在生成中，请等待完成后再操作')

  const accountId = detail.project.accountId
  const continuityAsset = await createCanvasAsset({
    accountId,
    projectId,
    category: 'continuityReport',
    targetEntityType: 'project',
    targetEntityId: projectId,
    pipelineRunId: runId ?? undefined,
  })

  try {
    await markCanvasAssetRunning(continuityAsset.id)

    const normalizedShots: NormalizedShot[] = detail.shots.map((shot): NormalizedShot => ({
      id: shot.id,
      shotIndex: shot.shotIndex,
      locationId: shot.locationId,
      characterIds: (shot.characterIdsJson ?? []) as string[],
      narrative: shot.narrative,
      duration: shot.duration,
      camera: shot.cameraJson,
      continuity: shot.continuityJson,
      timeline: shot.timelineJson ?? undefined,
      environment: shot.environmentJson ?? undefined,
    }))

    const normalizedCharacters: NormalizedCharacter[] = detail.characters.map(character => ({
      id: character.id,
      name: character.name,
      identityPrompt: character.identityPrompt ?? '',
      negativePrompt: character.negativePrompt ?? '',
    }))

    const normalizedLocations: NormalizedLocation[] = detail.locations.map((location) => {
      const cameraRules = location.profileJson?.cameraRules
      return {
        id: location.id,
        name: location.name,
        scenePrompt: location.scenePrompt ?? '',
        negativePrompt: location.negativePrompt ?? '',
        cameraRules: cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
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

    const outputJson: CanvasAssetOutput = { type: 'json', data: { issuesCount: issues.length, issues } }
    await markCanvasAssetSucceeded(continuityAsset.id, outputJson)
    await setCanvasAssetActive(continuityAsset.id)
    await updateCanvasProject(projectId, { status: 'continuity_checked' })

    return { phase: 'continuity', projectId, issuesFound: issues.length }
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markCanvasAssetFailed(continuityAsset.id, errorMessage).catch(() => {})
    throw error
  }
}
