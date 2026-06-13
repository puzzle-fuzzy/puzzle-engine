import type { CanvasAssetOutput } from '@excuse/db'
import type { WorkerConfig } from './config'
import { validateCharacterProfile } from '@excuse/canvas-engine'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  createCanvasCharacter,
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildCharacterPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import {
  assertCanvasProjectNotGenerating,
  createDashScopeClient,
  getTextModel,
} from './canvas-execution'

export interface CanvasCharactersResult extends Record<string, unknown> {
  phase: 'characters'
  projectId: string
  charactersCreated: number
  charactersFailed: number
}

export async function executeCanvasCharacters(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasCharactersResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertCanvasProjectNotGenerating(project.status)

  const analysis = project.analysisJson
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)
  const client = createDashScopeClient(workerConfig)
  let charactersCreated = 0
  let charactersFailed = 0

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  for (const name of analysis.characterNames) {
    try {
      await runCanvasAssetStep({
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
            const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
            throw new Error(`参数校验失败：${detail}`)
          }

          const result = await client.chatCompletion(textModel, validationResult.params)
          if (result.type === 'failed')
            throw new Error(result.error || '角色档案生成失败')

          const profile = validateCharacterProfile(parseLLMJson(result.output.text as string))
          await createCanvasCharacter({
            projectId,
            name: profile.name || name,
            role: profile.role,
            description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
            identityPrompt: profile.identityPrompt,
            negativePrompt: profile.negativePrompt,
            profileJson: profile,
          })

          const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
          return {
            result: undefined,
            output,
          }
        },
      })
      charactersCreated += 1
    }
    catch {
      charactersFailed += 1
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })

  return {
    phase: 'characters',
    projectId,
    charactersCreated,
    charactersFailed,
  }
}
