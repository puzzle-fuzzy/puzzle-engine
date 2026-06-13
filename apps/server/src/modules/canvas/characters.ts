import type { CanvasAssetOutput } from '@excuse/db'
import type { CharacterProfile } from '@excuse/shared'
import {
  buildCharacterPrompt,
  parseLLMJson,
} from '@excuse/prompt-engine'
import {
  createCanvasAsset,
  createCanvasCharacter,
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  setCanvasAssetActive,
  updateCanvasProject,
} from '@excuse/db'
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

    // ── 为角色档案创建 canvas_asset ──────────────────
    const profileAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterProfile',
      targetEntityType: 'project',
      targetEntityId: projectId,
      pipelineRunId: runId ?? undefined,
      model: textModel,
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(profileAsset.id)

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

      if (result.type === 'failed') {
        // ── 标记资产失败 ──────────────────────────────
        await markCanvasAssetFailed(profileAsset.id, result.error ?? '角色档案生成失败').catch(() => {})
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

      // ── 标记角色档案资产成功 + 设为活跃 ──────────────
      const outputJson: CanvasAssetOutput = { type: 'json', data: { ...profile } }
      await markCanvasAssetSucceeded(profileAsset.id, outputJson)
      await setCanvasAssetActive(profileAsset.id)

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile }, undefined, runId)
      created.push(character)
    }
    catch (error) {
      // ── 标记资产失败 ──────────────────────────────
      const errorMessage = (error as Error).message
      await markCanvasAssetFailed(profileAsset.id, errorMessage).catch(() => {})
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characters', charactersCreated: created.length })
  return getProjectDetail(projectId)
}
