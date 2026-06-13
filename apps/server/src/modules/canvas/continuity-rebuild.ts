import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import type { CanvasAssetOutput } from '@excuse/db'
import { validateShotContinuity } from '@excuse/canvas-engine'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  createContinuityReport,
  getCanvasProjectDetail,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
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

  try {
    const issues = await runCanvasAssetStep({
      asset: {
        accountId,
        projectId,
        category: 'continuityReport',
        targetEntityType: 'project',
        targetEntityId: projectId,
        pipelineRunId: runId ?? undefined,
      },
      execute: async () => {
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

        const output: CanvasAssetOutput = { type: 'json', data: { issuesCount: issues.length, issues } }
        return { result: issues, output }
      },
    })

    notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues }, undefined, runId)
    await updateCanvasProject(projectId, { status: 'continuity_checked' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'continuity', issuesFound: issues.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
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

          const output: CanvasAssetOutput = { type: 'text', text: videoPrompt }
          return { result: undefined, output }
        },
      })
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
