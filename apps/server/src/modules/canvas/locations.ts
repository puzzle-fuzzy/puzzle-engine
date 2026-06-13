import type { CanvasAssetOutput } from '@excuse/db'
import type { LocationProfile } from '@excuse/shared'
import { validateLocationProfile } from '@excuse/canvas-engine'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  createCanvasLocation,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildLocationPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import { getModelById, validateAndMerge } from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getTextModel, notifyNode } from './service-helpers'

export async function generateLocations(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running', undefined, undefined, runId)

    try {
      const profile = await runCanvasAssetStep<LocationProfile>({
        asset: {
          accountId,
          projectId,
          category: 'locationProfile',
          targetEntityType: 'project',
          targetEntityId: projectId,
          pipelineRunId: runId ?? undefined,
          model: textModel,
        },
        execute: async () => {
          const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
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
            throw new Error(result.error || '场景档案生成失败')

          const profile = validateLocationProfile(parseLLMJson(result.output.text as string))
          await createCanvasLocation({
            projectId,
            name: profile.name || name,
            type: profile.type,
            profileJson: profile,
            scenePrompt: profile.scenePrompt,
            negativePrompt: profile.negativePrompt,
          })

          const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
          return { result: profile, output }
        },
      })

      notifyNode(accountId, projectId, 'location', name, 'completed', { name: profile.name, profile }, undefined, runId)
    }
    catch (error) {
      const errorMessage = (error as Error).message
      notifyNode(accountId, projectId, 'location', name, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locations' })
  return getProjectDetail(projectId)
}
