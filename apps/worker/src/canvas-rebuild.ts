import type { CanvasAssetOutput } from '@excuse/db'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
import {
  loadRunnableCanvasProject,
  toNormalizedCharacter,
  toNormalizedLocation,
  toNormalizedShot,
} from './canvas-execution'

export interface CanvasRebuildResult extends Record<string, unknown> {
  phase: 'rebuild'
  projectId: string
  promptsBuilt: number
}

export async function executeCanvasRebuild(projectId: string, runId?: string): Promise<CanvasRebuildResult> {
  const detail = await loadRunnableCanvasProject(projectId)

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

    await runCanvasAssetStep({
      asset: {
        accountId,
        projectId,
        category: 'videoPrompt',
        targetEntityType: 'shot',
        targetEntityId: shot.id,
        pipelineRunId: runId ?? undefined,
      },
      execute: async () => {
        const { videoPrompt, negativePrompt } = buildShotVideoPrompt({
          shot: toNormalizedShot(shot),
          characters: shotCharacters.map(toNormalizedCharacter),
          location: toNormalizedLocation(shotLocation),
          timeline: shot.timelineJson ?? undefined,
          environment: shot.environmentJson ?? undefined,
        })

        await updateCanvasShot(shot.id, {
          videoPrompt,
          negativePrompt,
          status: 'ready',
        })

        const outputJson: CanvasAssetOutput = { type: 'text', text: videoPrompt }
        promptsBuilt += 1
        return { result: undefined, output: outputJson }
      },
    })
  }

  await updateCanvasProject(projectId, { status: 'prompts_ready' })
  return { phase: 'rebuild', projectId, promptsBuilt }
}
