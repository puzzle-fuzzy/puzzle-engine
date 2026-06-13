/**
 * 单个实体重新生成服务 — 创建同级节点（不删除旧实体）
 *
 * 角色重新生成: 用项目的 analysis + 角色 name 重新调用 LLM 生成新 profile，创建新角色行
 * 场景重新生成: 同上
 * 镜头视频重新生成: 复制镜头数据创建新镜头行，提交视频任务
 */
import type { CharacterProfile, LocationProfile } from '@excuse/shared'
import { calculateCost } from '@excuse/billing'
import {
  createCanvasCharacter,
  createCanvasLocation,
  createCanvasShot,
  createGenerationRecord,
  getCanvasCharacterById,
  getCanvasLocationById,
  getCanvasProjectById,
  getCanvasProjectDetail,
  getCanvasShotById,
  updateCanvasShot,
} from '@excuse/db'
import { getModelById as getProviderModelById, validateAndMerge } from '@excuse/provider'
import { extractBillingParams } from '@excuse/shared'
import { parseLLMJson } from './json-helper'
import { buildCharacterPrompt, buildLocationPrompt } from './prompts'
import { createClient, getTextModel, getVideoModel, notifyNode } from './service-helpers'
import { prepareCanvasVideoParams } from './videos'

// ── 角色重新生成 ──────────────────────────────────────

export async function regenerateCharacter(characterId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const character = await getCanvasCharacterById(characterId)
  if (!character)
    throw new Error('角色不存在')

  const project = await getCanvasProjectById(character.projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const name = character.name

  notifyNode(accountId, character.projectId, 'character', characterId, 'running')

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  try {
    const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
    const modelConfig = getProviderModelById(textModel)
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
      throw new Error(result.error || '角色重新生成失败')

    const profile = parseLLMJson<CharacterProfile>(result.output.text as string)
    const newCharacter = await createCanvasCharacter({
      projectId: character.projectId,
      name: profile.name || name,
      role: profile.role,
      description: `${profile.age} ${profile.gender} ${profile.bodyShape}`,
      identityPrompt: profile.identityPrompt,
      negativePrompt: profile.negativePrompt,
      profileJson: profile,
    })

    notifyNode(accountId, character.projectId, 'character', newCharacter.id, 'completed', { name: profile.name, profile })
    return newCharacter
  }
  catch (error) {
    notifyNode(accountId, character.projectId, 'character', characterId, 'failed', undefined, (error as Error).message)
    throw error
  }
}

// ── 场景重新生成 ──────────────────────────────────────

export async function regenerateLocation(locationId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const location = await getCanvasLocationById(locationId)
  if (!location)
    throw new Error('场景不存在')

  const project = await getCanvasProjectById(location.projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')

  const analysis = project.analysisJson!
  const accountId = project.accountId
  const name = location.name

  notifyNode(accountId, location.projectId, 'location', locationId, 'running')

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  try {
    const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
    const modelConfig = getProviderModelById(textModel)
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
      throw new Error(result.error || '场景重新生成失败')

    const profile = parseLLMJson<LocationProfile>(result.output.text as string)
    const newLocation = await createCanvasLocation({
      projectId: location.projectId,
      name: profile.name || name,
      type: profile.type,
      profileJson: profile,
      scenePrompt: profile.scenePrompt,
      negativePrompt: profile.negativePrompt,
    })

    notifyNode(accountId, location.projectId, 'location', newLocation.id, 'completed', { name: profile.name, profile })
    return newLocation
  }
  catch (error) {
    notifyNode(accountId, location.projectId, 'location', locationId, 'failed', undefined, (error as Error).message)
    throw error
  }
}

// ── 镜头视频重新生成（创建同级变体）──────────────────

export async function regenerateShotVideo(shotId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const shot = await getCanvasShotById(shotId)
  if (!shot)
    throw new Error('镜头不存在')

  const project = await getCanvasProjectById(shot.projectId)
  if (!project)
    throw new Error('项目不存在')

  const accountId = project.accountId
  const client = createClient(config)

  // 创建同级镜头 — 复制原镜头数据但用新 ID
  const newShot = await createCanvasShot({
    projectId: shot.projectId,
    shotIndex: shot.shotIndex + 0.5, // 紧接原镜头之后（后续排序会重新分配整数索引）
    duration: shot.duration,
    locationId: shot.locationId,
    characterIdsJson: shot.characterIdsJson,
    narrative: shot.narrative,
    cameraJson: shot.cameraJson,
    continuityJson: shot.continuityJson,
    timelineJson: shot.timelineJson,
    environmentJson: shot.environmentJson,
    videoPrompt: shot.videoPrompt,
    negativePrompt: shot.negativePrompt,
    status: 'draft',
  })

  notifyNode(accountId, shot.projectId, 'shot', newShot.id, 'running')

  try {
    // 查找参考图
    const projectDetail = await getCanvasProjectDetail(shot.projectId)
    if (!projectDetail)
      throw new Error('项目详情不存在')

    const characterMap = new Map(projectDetail.characters.map(c => [c.id, c]))
    const locationMap = new Map(projectDetail.locations.map(l => [l.id, l]))

    const charRefUrls = newShot.characterIdsJson
      .map(id => characterMap.get(id)?.referenceImageUrl)
      .filter(Boolean) as string[]
    const locRefUrl = newShot.locationId
      ? locationMap.get(newShot.locationId)?.referenceImageUrl ?? null
      : null
    const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

    const model = getVideoModel(project.modelPreferencesJson, referenceUrls)
    const { params: videoParams } = prepareCanvasVideoParams(model, {
      videoPrompt: newShot.videoPrompt || '',
      negativePrompt: newShot.negativePrompt || undefined,
      duration: newShot.duration,
    })

    const submitResult = await client.submitVideoTaskWithFallback(
      model,
      videoParams,
      referenceUrls.length > 0 ? referenceUrls : undefined,
    )

    if (!submitResult.success || !submitResult.taskId) {
      await updateCanvasShot(newShot.id, { status: 'failed', errorMessage: submitResult.error })
      notifyNode(accountId, shot.projectId, 'shot', newShot.id, 'failed', undefined, submitResult.error)
      throw new Error(submitResult.error || '视频提交失败')
    }

    await updateCanvasShot(newShot.id, {
      videoTaskId: submitResult.taskId,
      status: 'generating',
    })

    // 创建计费记录
    const usedModelConfig = getProviderModelById(submitResult.model)
    if (usedModelConfig) {
      const cost = calculateCost(usedModelConfig, extractBillingParams(videoParams))
      await createGenerationRecord({
        accountId,
        taskId: submitResult.taskId!,
        model: submitResult.model,
        category: 'video',
        status: 'processing',
        inputParams: { source: 'canvas', projectId: shot.projectId, shotId: newShot.id, ...videoParams },
        cost,
      })
    }

    return newShot
  }
  catch (error) {
    notifyNode(accountId, shot.projectId, 'shot', newShot.id, 'failed', undefined, (error as Error).message)
    throw error
  }
}
