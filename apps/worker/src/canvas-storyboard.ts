import type { CanvasAssetOutput } from '@excuse/db'
import type { ShotDraft } from '@excuse/shared'
import type { WorkerConfig } from './config'
import {
  batchCreateCanvasShots,
  deleteCanvasShotsByProject,
  updateCanvasProject,
} from '@excuse/db'
import {
  getModelById,
  validateAndMerge,
} from '@excuse/provider'
import {
  buildStoryboardPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import {
  createDashScopeClient,
  getTextModel,
  loadRunnableCanvasProject,
  runCanvasAssetStep,
} from './canvas-execution'

export interface CanvasStoryboardResult extends Record<string, unknown> {
  phase: 'storyboard'
  projectId: string
  shotsCreated: number
}

export async function executeCanvasStoryboard(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasStoryboardResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const textModel = getTextModel(project.modelPreferencesJson)
  const accountId = project.accountId

  return runCanvasAssetStep<CanvasStoryboardResult>({
    asset: {
      accountId,
      projectId,
      category: 'storyboard',
      targetEntityType: 'project',
      targetEntityId: projectId,
      pipelineRunId: runId ?? undefined,
      model: textModel,
    },
    execute: async () => {
      const client = createDashScopeClient(workerConfig)
      const { system, prompt: userPrompt } = buildStoryboardPrompt(
        project.storyText,
        project.analysisJson!,
        detail.characters.map(character => ({
          id: character.id,
          name: character.name,
          identityPrompt: character.identityPrompt || '',
        })),
        detail.locations.map(location => ({
          id: location.id,
          name: location.name,
          scenePrompt: location.scenePrompt || '',
        })),
      )

      const modelConfig = getModelById(textModel)
      if (!modelConfig)
        throw new Error(`未知文本模型：${textModel}`)

      const rawParams: Record<string, unknown> = {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 8000,
        temperature: 0.7,
      }
      const validationResult = validateAndMerge(modelConfig, rawParams)
      if (!validationResult.ok) {
        const detail = validationResult.errors.map(error => `${error.field}: ${error.message}`).join('; ')
        throw new Error(`参数校验失败：${detail}`)
      }

      const result = await client.chatCompletion(textModel, validationResult.params)
      if (result.type === 'failed')
        throw new Error(result.error || '分镜生成失败')

      const shots = parseLLMJson<ShotDraft[]>(result.output.text as string)

      await deleteCanvasShotsByProject(projectId)
      const created = await batchCreateCanvasShots(shots.map(shot => ({
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
      })))

      await updateCanvasProject(projectId, { status: 'storyboard_ready' })

      const output: CanvasAssetOutput = { type: 'json', data: { shotsCount: created.length, shots } }
      return {
        result: { phase: 'storyboard', projectId, shotsCreated: created.length },
        output,
      }
    },
  })
}
