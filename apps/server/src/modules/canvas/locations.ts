import type { LocationProfile } from '@excuse/shared'
import {
  createCanvasLocation,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { parseLLMJson } from './json-helper'
import { buildLocationPrompt } from './prompts'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getTextModel, notifyNode } from './service-helpers'

export async function generateLocations(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running', undefined, undefined, runId)

    try {
      const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
        notifyNode(accountId, projectId, 'location', name, 'failed', undefined, result.error, runId)
        continue
      }

      const profile = parseLLMJson<LocationProfile>(result.output.text as string)
      await createCanvasLocation({
        projectId,
        name: profile.name || name,
        type: profile.type,
        profileJson: profile,
        scenePrompt: profile.scenePrompt,
        negativePrompt: profile.negativePrompt,
      })

      notifyNode(accountId, projectId, 'location', name, 'completed', { name: profile.name, profile }, undefined, runId)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', name, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locations' })
  return getProjectDetail(projectId)
}
