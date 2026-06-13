import type { CanvasAssetOutput } from '@excuse/db'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'

export interface CanvasRebuildResult extends Record<string, unknown> {
  phase: 'rebuild'
  projectId: string
  promptsBuilt: number
}

export async function executeCanvasRebuild(projectId: string, runId?: string): Promise<CanvasRebuildResult> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  if (detail.project.status === 'generating')
    throw new Error('项目正在生成中，请等待完成后再操作')

  const accountId = detail.project.accountId
  const characterMap = new Map(detail.characters.map(character => [character.id, character]))
  const locationMap = new Map(detail.locations.map(location => [location.id, location]))
  let promptsBuilt = 0

  for (const shot of detail.shots) {
    const shotCharacters = shot.characterIdsJson
      .map(id => characterMap.get(id))
      .filter(Boolean) as typeof detail.characters

    const shotLocation = shot.locationId ? locationMap.get(shot.locationId) : undefined
    if (!shotLocation)
      continue

    const promptAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'videoPrompt',
      targetEntityType: 'shot',
      targetEntityId: shot.id,
      pipelineRunId: runId ?? undefined,
    })

    try {
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
        characters: shotCharacters.map(character => ({
          id: character.id,
          name: character.name,
          identityPrompt: character.identityPrompt ?? '',
          negativePrompt: character.negativePrompt ?? '',
        })),
        location: {
          id: shotLocation.id,
          name: shotLocation.name,
          scenePrompt: shotLocation.scenePrompt ?? '',
          negativePrompt: shotLocation.negativePrompt ?? '',
          cameraRules: shotLocation.profileJson?.cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
        },
        timeline: shot.timelineJson ?? undefined,
        environment: shot.environmentJson ?? undefined,
      })

      await updateCanvasShot(shot.id, {
        videoPrompt,
        negativePrompt,
        status: 'ready',
      })

      const outputJson: CanvasAssetOutput = { type: 'text', text: videoPrompt }
      await markCanvasAssetSucceeded(promptAsset.id, outputJson)
      await setCanvasAssetActive(promptAsset.id)
      promptsBuilt += 1
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      await markCanvasAssetFailed(promptAsset.id, errorMessage).catch(() => {})
      throw error
    }
  }

  await updateCanvasProject(projectId, { status: 'prompts_ready' })
  return { phase: 'rebuild', projectId, promptsBuilt }
}
