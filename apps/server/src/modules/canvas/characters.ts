import type { CanvasAssetOutput } from '@excuse/db'
import { validateCharacterProfile } from '@excuse/canvas-engine'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  createCanvasCharacter,
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildCharacterPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import { getModelById, validateAndMerge } from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getTextModel, notifyNode } from './service-helpers'

export async function generateCharacters(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const created = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running', undefined, undefined, runId)

    try {
      const { character, profile } = await runCanvasAssetStep({
        asset: {
          accountId,
          projectId,
          category: 'characterProfile',
          targetEntityType: 'project',
          targetEntityId: projectId,
          pipelineRunId: runId ?? undefined,
          model: textModel,
        },
        execute: async () => {
          const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
          const modelConfig = getModelById(textModel)
          if (!modelConfig)
            throw new Error(`未知文本模型：${textModel}`)

          const rawParams: Record<string, unknown> = {
            prompt: `${system}\n\n${userPrompt}`,
            max_tokens: 4096,
            temperature: 0.7,
          }
          const validationResult = validateAndMerge(modelConfig, rawParams)
          if (!validationResult.ok) {
            const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
            throw new Error(`参数校验失败：${detail}`)
          }

          const result = await client.chatCompletion(textModel, validationResult.params)
          if (result.type === 'failed')
            throw new Error(result.error || '角色档案生成失败')

          const profile = validateCharacterProfile(parseLLMJson(result.output.text as string))
          const character = await createCanvasCharacter({
            projectId,
            name: profile.name || name,
            role: profile.role,
            description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
            identityPrompt: profile.identityPrompt,
            negativePrompt: profile.negativePrompt,
            profileJson: profile,
          })

          const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
          return { result: { character, profile }, output }
        },
      })

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile }, undefined, runId)
      created.push(character)
    }
    catch (error) {
      const errorMessage = (error as Error).message
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characters', charactersCreated: created.length })
  return getProjectDetail(projectId)
}
