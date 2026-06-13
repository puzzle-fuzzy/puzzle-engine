import type { CanvasAssetOutput } from '@excuse/db'
import type { NovelAnalysis } from '@excuse/shared'
import type { WorkerConfig } from './config'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildAnalysisPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import {
  createDashScopeClient,
  getTextModel,
  runCanvasAssetStep,
} from './canvas-execution'

export interface CanvasAnalysisResult extends Record<string, unknown> {
  phase: 'analyze'
  projectId: string
  analysis: NovelAnalysis
}

export async function executeCanvasAnalysis(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasAnalysisResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  const textModel = getTextModel(project.modelPreferencesJson)

  return runCanvasAssetStep<CanvasAnalysisResult>({
    asset: {
      accountId: project.accountId,
      projectId,
      category: 'analysis',
      targetEntityType: 'project',
      targetEntityId: projectId,
      pipelineRunId: runId ?? undefined,
      model: textModel,
    },
    execute: async () => {
      if (project.status !== 'draft') {
        await deleteCanvasShotsByProject(projectId)
        await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
        await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
      }

      const client = createDashScopeClient(workerConfig)
      const { system, prompt: userPrompt } = buildAnalysisPrompt(project.storyText)

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
        throw new Error(result.error || '分析失败')

      const analysis = parseLLMJson<NovelAnalysis>(result.output.text as string)

      await updateCanvasProject(projectId, {
        status: 'analyzed',
        analysisJson: analysis,
      })

      const output: CanvasAssetOutput = { type: 'json', data: { ...analysis } }
      return {
        result: { phase: 'analyze', projectId, analysis },
        output,
      }
    },
  })
}
