import type { CanvasAssetOutput } from '@excuse/db'
import { validateShotDrafts } from '@excuse/canvas-engine'
import { runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  batchCreateCanvasShots,
  deleteCanvasShotsByProject,
  getCanvasProjectDetail,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasProject,
} from '@excuse/db'
import {
  buildStoryboardPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import { getModelById, validateAndMerge } from '@excuse/provider'
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
  const textModel = getTextModel(project.modelPreferencesJson)

  notifyNode(accountId, projectId, 'storyboard', projectId, 'running', undefined, undefined, runId)

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const created = await runCanvasAssetStep({
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
        const client = createClient(config)
        const { system, prompt: userPrompt } = buildStoryboardPrompt(
          project.storyText,
          analysis,
          detail.characters.map(c => ({ id: c.id, name: c.name, identityPrompt: c.identityPrompt || '' })),
          detail.locations.map(l => ({ id: l.id, name: l.name, scenePrompt: l.scenePrompt || '' })),
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
          const detail = validationResult.errors.map(e => `${e.field}: ${e.message}`).join('; ')
          throw new Error(`参数校验失败：${detail}`)
        }

        const result = await client.chatCompletion(textModel, validationResult.params)
        if (result.type === 'failed')
          throw new Error(result.error || '分镜生成失败')

        const shots = validateShotDrafts(parseLLMJson(result.output.text as string))
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
        const output: CanvasAssetOutput = { type: 'json', data: { shotsCount: created.length, shots } }
        return { result: created, output }
      },
    })

    for (const shot of created)
      notifyNode(accountId, projectId, 'shot', shot.id, 'completed', undefined, undefined, runId)

    await updateCanvasProject(projectId, { status: 'storyboard_ready' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'storyboard', shotsCreated: created.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    const errorMessage = (error as Error).message
    notifyNode(accountId, projectId, 'storyboard', projectId, 'failed', undefined, errorMessage, runId)
    if (runId)
      await markPipelineRunFailed(runId, errorMessage)
    throw error
  }
}
