import type { CharacterProfile } from '@excuse/shared'
import {
  createCanvasCharacter,
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { parseLLMJson } from './json-helper'
import { buildCharacterPrompt } from './prompts'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getTextModel, notifyNode } from './service-helpers'

export async function generateCharacters(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  const created = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running', undefined, undefined, runId)

    try {
      const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
        notifyNode(accountId, projectId, 'character', name, 'failed', undefined, result.error, runId)
        continue
      }

      const profile = parseLLMJson<CharacterProfile>(result.output.text as string)
      const character = await createCanvasCharacter({
        projectId,
        name: profile.name || name,
        role: profile.role,
        description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
        identityPrompt: profile.identityPrompt,
        negativePrompt: profile.negativePrompt,
        profileJson: profile,
      })

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile }, undefined, runId)
      created.push(character)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characters', charactersCreated: created.length })
  return getProjectDetail(projectId)
}
