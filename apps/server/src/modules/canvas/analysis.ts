import type { NovelAnalysis } from '@excuse/shared'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import { getModelById, validateAndMerge } from '@excuse/provider'
import { parseLLMJson } from './json-helper'
import { buildAnalysisPrompt } from './prompts'
import { getProjectDetail } from './service-crud'
import { createClient, getTextModel, notifyNode } from './service-helpers'

export async function analyzeProject(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  if (runId)
    await markPipelineRunRunning(runId)
  notifyNode(project.accountId, projectId, 'analysis', projectId, 'running', undefined, undefined, runId)

  if (project.status !== 'draft') {
    await deleteCanvasShotsByProject(projectId)
    await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
    await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  }

  try {
    const client = createClient(config)
    const { system, prompt: userPrompt } = buildAnalysisPrompt(project.storyText)

    const textModel = getTextModel(project.modelPreferencesJson)
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

    if (result.type === 'failed') {
      throw new Error(result.error || '分析失败')
    }

    const text = result.output.text as string
    const analysis = parseLLMJson<NovelAnalysis>(text)

    await updateCanvasProject(projectId, {
      status: 'analyzed',
      analysisJson: analysis,
    })

    notifyNode(project.accountId, projectId, 'analysis', projectId, 'completed', { analysis }, undefined, runId)
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'analyze' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    notifyNode(project.accountId, projectId, 'analysis', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}
