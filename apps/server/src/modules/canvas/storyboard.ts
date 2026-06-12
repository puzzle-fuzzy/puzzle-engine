import type { ShotDraft } from '@excuse/shared'
import {
  batchCreateCanvasShots,
  deleteCanvasShotsByProject,
  getCanvasProjectDetail,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { parseLLMJson } from './json-helper'
import { buildStoryboardPrompt } from './prompts'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getTextModel, notifyNode } from './service-helpers'

export async function generateStoryboard(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const analysis = project.analysisJson!
  const accountId = project.accountId

  notifyNode(accountId, projectId, 'storyboard', projectId, 'running', undefined, undefined, runId)

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const client = createClient(config)
    const { system, prompt: userPrompt } = buildStoryboardPrompt(
      project.storyText,
      analysis,
      detail.characters.map(c => ({ id: c.id, name: c.name, identityPrompt: c.identityPrompt || '' })),
      detail.locations.map(l => ({ id: l.id, name: l.name, scenePrompt: l.scenePrompt || '' })),
    )

    const textModel = getTextModel(project.modelPreferencesJson)
    const result = await client.chatCompletion(textModel, {
      prompt: `${system}\n\n${userPrompt}`,
      max_tokens: 8192,
      temperature: 0.7,
    })

    if (!result.success || !result.output) {
      throw new Error(result.error || '分镜生成失败')
    }

    const shots = parseLLMJson<ShotDraft[]>(result.output.text as string)

    await deleteCanvasShotsByProject(projectId)

    const shotInserts = shots.map(shot => ({
      projectId,
      shotIndex: shot.shotIndex,
      duration: shot.duration,
      locationId: shot.locationId,
      characterIdsJson: shot.characterIds,
      narrative: shot.narrative,
      cameraJson: shot.camera,
      continuityJson: shot.continuity,
      timelineJson: shot.timeline ?? null,
      environmentJson: shot.environment ?? null,
    }))

    const created = await batchCreateCanvasShots(shotInserts)

    for (const shot of created) {
      notifyNode(accountId, projectId, 'shot', shot.id, 'completed', undefined, undefined, runId)
    }

    await updateCanvasProject(projectId, { status: 'storyboard_ready' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'storyboard', shotsCreated: created.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(accountId, projectId, 'storyboard', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}
