import type { CanvasAssetOutput } from '@excuse/db'
import type { LocationProfile } from '@excuse/shared'
import type { WorkerConfig } from './config'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  createCanvasLocation,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildLocationPrompt,
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

export interface CanvasLocationsResult extends Record<string, unknown> {
  phase: 'locations'
  projectId: string
  locationsCreated: number
  locationsFailed: number
}

export async function executeCanvasLocations(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasLocationsResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertCanvasProjectNotGenerating(project.status)

  const analysis = project.analysisJson
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)
  const client = createDashScopeClient(workerConfig)
  let locationsCreated = 0
  let locationsFailed = 0

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  for (const name of analysis.sceneNames) {
    try {
      await runCanvasAssetStep({
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
            const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
            throw new Error(`参数校验失败：${detail}`)
          }

          const result = await client.chatCompletion(textModel, validationResult.params)
          if (result.type === 'failed')
            throw new Error(result.error || '场景档案生成失败')

          const profile = parseLLMJson<LocationProfile>(result.output.text as string)
          await createCanvasLocation({
            projectId,
            name: profile.name || name,
            type: profile.type,
            profileJson: profile,
            scenePrompt: profile.scenePrompt,
            negativePrompt: profile.negativePrompt,
          })

          const output: CanvasAssetOutput = { type: 'json', data: { ...profile } }
          return {
            result: undefined,
            output,
          }
        },
      })
      locationsCreated += 1
    }
    catch {
      locationsFailed += 1
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })

  return {
    phase: 'locations',
    projectId,
    locationsCreated,
    locationsFailed,
  }
}
