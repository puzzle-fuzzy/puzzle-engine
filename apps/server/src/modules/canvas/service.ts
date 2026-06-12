/**
 * Canvas 核心业务服务
 *
 * 提供 AI 视频制作流水线的全部业务逻辑，包括：
 *
 * 1. 项目 CRUD（创建、查询、更新、软删除）
 * 2. 流水线阶段执行（9 个阶段，按序依赖）：
 *      analyze → characters → locations → characterRefs → locationRefs
 *      → storyboard → continuity → rebuild → generateVideos
 * 3. 资源编辑（角色/场景/镜头的 PATCH/DELETE）
 * 4. 重试机制（单镜头重试、批量失败重试）
 *
 * 设计原则：
 *   - 每个阶段函数都是幂等的（会先清理旧数据再重建）
 *   - 通过 assertNotGenerating 防止生成期间的数据竞争
 *   - 通过 reconcileProjectShots 回填中断后遗留的 generating 状态
 *   - 所有 SSE 通知通过 notifyNode 统一发送
 *
 * 调用方（canvas route）通过 fireAndForget 在后台执行，
 * 函数内部自行管理 DB 状态和 SSE 通知。
 */
import type { ShotCamera, ShotEnvironment } from '@excuse/db'
import type { OSSConfig } from '@excuse/provider'
import type { CanvasModelPreferences, CharacterProfile, LocationProfile, NovelAnalysis, ShotDraft } from '@excuse/shared'
import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from './continuity'
import { calculateCost } from '@excuse/billing'
import {
  batchCreateCanvasShots,
  createCanvasCharacter,
  createCanvasLocation,
  createCanvasProject,
  createContinuityReport,
  createGenerationRecord,
  deleteCanvasCharacterById,
  deleteCanvasCharactersByProject,
  deleteCanvasLocationById,
  deleteCanvasLocationsByProject,
  deleteCanvasShotById,
  deleteCanvasShotsByProject,
  getCanvasCharacterById,
  getCanvasLocationById,
  getCanvasProjectById,
  getCanvasProjectDetail,
  getCanvasShotById,
  getGenerationRecordsByTaskIds,
  listCanvasProjectsByAccount,
  listCanvasShotsByProject,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  resetCanvasShotToDraft,
  softDeleteCanvasProject,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { AssetStorage, DashScopeClient, getModelById } from '@excuse/provider'
import { dispatchToUser } from '../../services/sse-manager'
import { validateShotContinuity } from './continuity'
import { parseLLMJson } from './json-helper'
import { mapProjectDetail } from './mapper'
import { buildShotVideoPrompt } from './prompt-builder'
import { buildAnalysisPrompt, buildCharacterPrompt, buildLocationPrompt, buildStoryboardPrompt } from './prompts'

/** 创建 DashScope API 客户端，每个 pipeline 阶段调用时独立创建 */
function createClient(config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  return new DashScopeClient({ apiKey: config.dashscopeApiKey, baseUrl: config.dashscopeBaseUrl })
}

/**
 * SSE 通知快捷方法 — 向指定用户推送 pipeline 节点状态更新
 *
 * @param nodeType - 节点类型：'analysis'|'character'|'location'|'shot'|'storyboard'|'continuity'|'prompts'
 * @param nodeId   - 节点 ID：通常是资源 ID（character.id）或项目 ID（分析阶段）
 * @param status   - 节点状态：'running'|'completed'|'failed'
 */
function notifyNode(accountId: string, projectId: string, nodeType: string, nodeId: string, status: 'running' | 'completed' | 'failed', data?: Record<string, unknown>, error?: string, runId?: string) {
  dispatchToUser(accountId, 'pipeline_node_update', { projectId, nodeType, nodeId, status, data, error, runId })
}

/** 默认模型 ID — 当 modelPreferences 未设置时使用 */
const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'
const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro'

/** 从用户偏好中解析文本模型 ID，未设置则用默认值 */
function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

/** 从用户偏好中解析图像模型 ID，未设置则用默认值 */
function getImageModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.imageModel || DEFAULT_IMAGE_MODEL
}

/**
 * 选择视频模型：根据是否有参考图决定 r2v/t2v 变体。
 * 优先使用 modelPreferences.videoModel 的基础名，再拼 -r2v/-t2v 后缀。
 */
function getVideoModel(prefs: CanvasModelPreferences | null | undefined, referenceUrls: string[]): string {
  const base = prefs?.videoModel || 'happyhorse-1.0'
  // r2v models exist only for happyhorse and wan2.7 — strip -r2v/-t2v suffix to get base
  const strippedBase = base.replace(/-r2v$|-t2v$|-i2v$/, '')
  return referenceUrls.length > 0 ? `${strippedBase}-r2v` : `${strippedBase}-t2v`
}

// ===== 项目 CRUD =====

/** 创建新 Canvas 项目，初始状态为 'draft' */
export async function createProject(accountId: string, input: { title?: string, storyText: string }) {
  const project = await createCanvasProject({
    accountId,
    title: input.title ?? null,
    storyText: input.storyText,
    status: 'draft',
  })
  return mapProjectDetail(project, [], [], [], null)
}

/** 更新项目标题和/或故事文本，返回更新后的完整项目详情 */
export async function updateProjectProperties(projectId: string, input: { title?: string, storyText?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  const values: Partial<Pick<typeof project, 'title' | 'storyText'>> = {}
  if (input.title !== undefined)
    values.title = input.title
  if (input.storyText !== undefined)
    values.storyText = input.storyText

  const updated = await updateCanvasProject(projectId, values)
  if (!updated)
    throw new Error('更新失败')

  const detail = await getCanvasProjectDetail(projectId)
  return mapProjectDetail(updated, detail?.characters ?? [], detail?.locations ?? [], detail?.shots ?? [], detail?.latestContinuity ?? null)
}

/**
 * 回填历史数据：将 canvas_shots 中停留在 'generating' 的镜头
 * 从 generation_records 同步真实状态和视频 URL。
 */
async function reconcileProjectShots(projectId: string) {
  const shots = await listCanvasShotsByProject(projectId)
  const staleShots = shots.filter(s => s.status === 'generating' && s.videoTaskId)

  if (staleShots.length === 0)
    return

  const taskIds = staleShots.map(s => s.videoTaskId!).filter(Boolean)
  const records = await getGenerationRecordsByTaskIds(taskIds)
  const recordMap = new Map(records.map(r => [r.taskId, r]))

  let anyUpdated = false
  for (const shot of staleShots) {
    const record = recordMap.get(shot.videoTaskId!)
    if (!record)
      continue

    if (record.status === 'succeeded') {
      const output = record.outputResult
      if (!output || !('savedUrls' in output))
        continue
      const savedUrls = output.savedUrls
      await updateCanvasShot(shot.id, {
        status: 'completed',
        videoUrl: savedUrls?.[0] || undefined,
      })
      anyUpdated = true
    }
    else if (record.status === 'failed') {
      await updateCanvasShot(shot.id, {
        status: 'failed',
        errorMessage: record.errorMessage || undefined,
      })
      anyUpdated = true
    }
  }

  if (anyUpdated) {
    const updatedShots = await listCanvasShotsByProject(projectId)
    const stillGenerating = updatedShots.some(s => s.status === 'generating')
    if (!stillGenerating && updatedShots.length > 0) {
      const allSucceeded = updatedShots.every(s => s.status === 'completed')
      // 全部成功 → completed；存在失败 → partial_failed
      await updateCanvasProject(projectId, {
        status: allSucceeded ? 'completed' : 'partial_failed',
      })
    }
  }
}

/**
 * 获取项目详情 — 含自动回填机制
 *
 * 当项目处于 generating/partial_failed/refs_all_ready 状态时，
 * 自动触发 reconcileProjectShots() 将遗留的 'generating' 镜头
 * 与 generation_records 表同步，修复中断后的不一致状态。
 */
export async function getProjectDetail(projectId: string) {
  const project = await getCanvasProjectById(projectId)
  // 触发 reconcile：generating / partial_failed（重试后）/ refs_all_ready
  if (project && (project.status === 'generating' || project.status === 'partial_failed' || project.status === 'refs_all_ready'))
    await reconcileProjectShots(projectId)
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    return null
  return mapProjectDetail(detail.project, detail.characters, detail.locations, detail.shots, detail.latestContinuity)
}

export async function listProjects(accountId: string) {
  const projects = await listCanvasProjectsByAccount(accountId)
  return Promise.all(projects.map(async (p) => {
    const detail = await getCanvasProjectDetail(p.id)
    return mapProjectDetail(p, detail?.characters ?? [], detail?.locations ?? [], detail?.shots ?? [], detail?.latestContinuity ?? null)
  }))
}

export async function softDeleteProject(projectId: string) {
  return softDeleteCanvasProject(projectId)
}

export async function saveCanvasLayout(projectId: string, layout: import('@excuse/shared').CanvasLayoutDto) {
  return updateCanvasProject(projectId, { canvasLayout: layout })
}

// ===== 流水线步骤 =====
// 执行顺序：analyze → characters → locations → characterRefs → locationRefs
//           → storyboard → continuity → rebuild → generateVideos

/** 流水线状态守卫：防止对正在 generating 的项目重复触发其他阶段 */
function assertNotGenerating(status: string | null | undefined): void {
  if (status === 'generating') {
    throw new Error('项目正在生成中，请等待完成后再操作')
  }
}

/**
 * 阶段 1：LLM 分析故事文本
 *
 * 提取 summary, mainConflict, timeline, characterNames, sceneNames。
 * 重复分析时会清除下游数据（shots/locations/characters，保留 locked 资源）。
 * 成功后项目状态变为 'analyzed'。
 */
export async function analyzeProject(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  if (runId)
    await markPipelineRunRunning(runId)
  notifyNode(project.accountId, projectId, 'analysis', projectId, 'running', undefined, undefined, runId)

  // Re-analysis resets downstream data to ensure consistency
  if (project.status !== 'draft') {
    await deleteCanvasShotsByProject(projectId)
    await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
    await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  }

  try {
    const client = createClient(config)
    const { system, prompt: userPrompt } = buildAnalysisPrompt(project.storyText)

    const textModel = getTextModel(project.modelPreferencesJson)
    const result = await client.chatCompletion(textModel, {
      prompt: `${system}\n\n${userPrompt}`,
      max_tokens: 4096,
      temperature: 0.7,
    })

    if (!result.success || !result.output) {
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
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(project.accountId, projectId, 'analysis', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}

/**
 * 阶段 2：逐角色生成档案
 *
 * 为 analysis.characterNames 中每个角色调用 LLM，生成 CharacterProfile。
 * 包含外观、identityPrompt、negativePrompt 等视觉描述。
 * 角色变更会级联清除下游 storyboard。
 * 成功后项目状态变为 'characters_ready'。
 */
export async function generateCharacters(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  // Characters changed → downstream storyboard references become stale
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  const created = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running', undefined, undefined, runId)

    try {
      const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
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

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile }, undefined, runId)
      created.push(character)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characters', charactersCreated: created.length })
  return getProjectDetail(projectId)
}

/**
 * 阶段 3：逐场景生成档案
 *
 * 为 analysis.sceneNames 中每个场景调用 LLM，生成 LocationProfile。
 * 包含 scenePrompt、negativePrompt、cameraRules 等视觉约束。
 * 场景变更会级联清除下游 storyboard。
 * 成功后项目状态变为 'locations_ready'。
 */
export async function generateLocations(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  // Locations changed → downstream storyboard references become stale
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running', undefined, undefined, runId)

    try {
      const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
        notifyNode(accountId, projectId, 'location', name, 'failed', undefined, result.error, runId)
        continue
      }

      const profile = parseLLMJson<LocationProfile>(result.output.text as string)
      await createCanvasLocation({
        projectId,
        name: profile.name || name,
        type: profile.type,
        profileJson: profile,
        scenePrompt: profile.scenePrompt,
        negativePrompt: profile.negativePrompt,
      })

      notifyNode(accountId, projectId, 'location', name, 'completed', { name: profile.name, profile }, undefined, runId)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', name, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locations' })
  return getProjectDetail(projectId)
}

/**
 * 阶段 4：生成角色参考图（正面肖像 + 三视图 turnaround sheet）
 *
 * 为每个非 locked 且无 referenceImageUrl 的角色生成两张 AI 图：
 *   - portrait: 正面肖像，纯色背景
 *   - turnaround: 前后左右三视图
 * 图片下载保存到存储后更新 character.referenceImageUrl / turnaroundSheetUrl。
 * 成功后项目状态变为 'refs_ready'。
 */
export async function generateCharacterRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const char of detail.characters) {
    if (char.locked || !char.identityPrompt || char.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'character', char.id, 'running', undefined, undefined, runId)

    try {
      const portraitResult = await client.generateImage(imageModel, {
        prompt: `${char.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`,
        size: '2048*2048',
        n: 1,
      })

      if (portraitResult.success && portraitResult.output) {
        const urls = portraitResult.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${char.id}`, 'portrait')
          await updateCanvasCharacter(char.id, { referenceImageUrl: savedUrls[0] || urls[0] })
        }
      }

      const turnaroundResult = await client.generateImage(imageModel, {
        prompt: `${char.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`,
        size: '2048*2048',
        n: 1,
      })

      if (turnaroundResult.success && turnaroundResult.output) {
        const urls = turnaroundResult.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${char.id}`, 'turnaround')
          await updateCanvasCharacter(char.id, { turnaroundSheetUrl: savedUrls[0] || urls[0] })
        }
      }

      notifyNode(accountId, projectId, 'character', char.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'character', char.id, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characterRefs' })
  return getProjectDetail(projectId)
}

/**
 * 阶段 5：生成场景参考图
 *
 * 为每个非 locked 且无 referenceImageUrl 的场景生成一张 AI 空场景图。
 * 提示词强制要求无人、无角色。
 * 成功后项目状态变为 'refs_all_ready'。
 */
export async function generateLocationRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const loc of detail.locations) {
    if (loc.locked || !loc.scenePrompt || loc.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'location', loc.id, 'running', undefined, undefined, runId)

    try {
      const result = await client.generateImage(imageModel, {
        prompt: `${loc.scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`,
        size: '2048*2048',
        n: 1,
      })

      if (result.success && result.output) {
        const urls = result.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${loc.id}`, 'ref')
          await updateCanvasLocation(loc.id, { referenceImageUrl: savedUrls[0] || urls[0] })
        }
      }

      notifyNode(accountId, projectId, 'location', loc.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', loc.id, 'failed', undefined, (error as Error).message, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locationRefs' })
  return getProjectDetail(projectId)
}

/**
 * 阶段 6：LLM 生成分镜脚本
 *
 * 将故事文本 + 角色 + 场景传给 LLM，生成 ShotDraft[]。
 * 每个 shot 包含 duration, locationId, characterIds, narrative, camera,
 * continuity, timeline, environment。
 * 成功后项目状态变为 'storyboard_ready'。
 */
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

  notifyNode(accountId, projectId, 'storyboard', projectId, 'running', undefined, undefined, runId)

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const client = createClient(config)
    const { system, prompt: userPrompt } = buildStoryboardPrompt(
      project.storyText,
      analysis,
      detail.characters.map(c => ({ id: c.id, name: c.name, identityPrompt: c.identityPrompt || '' })),
      detail.locations.map(l => ({ id: l.id, name: l.name, scenePrompt: l.scenePrompt || '' })),
    )

    const textModel = getTextModel(project.modelPreferencesJson)
    const result = await client.chatCompletion(textModel, {
      prompt: `${system}\n\n${userPrompt}`,
      max_tokens: 8192,
      temperature: 0.7,
    })

    if (!result.success || !result.output) {
      throw new Error(result.error || '分镜生成失败')
    }

    const shots = parseLLMJson<ShotDraft[]>(result.output.text as string)

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

    for (const shot of created) {
      notifyNode(accountId, projectId, 'shot', shot.id, 'completed', undefined, undefined, runId)
    }

    await updateCanvasProject(projectId, { status: 'storyboard_ready' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'storyboard', shotsCreated: created.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(accountId, projectId, 'storyboard', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}

/**
 * 阶段 7：规则校验连续性
 *
 * 纯规则检查（不调用 LLM），检测相邻镜头间的连续性问题：
 *   - 缺失场景/角色引用
 *   - 禁止的摄影角度
 *   - 180 度规则违反
 *   - 动作/情绪不连续
 * 结果存入 continuity_report 表。
 * 成功后项目状态变为 'continuity_checked'。
 */
export async function checkContinuity(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const normalizedShots: NormalizedShot[] = detail.shots.map((s): NormalizedShot => ({
      id: s.id,
      shotIndex: s.shotIndex,
      locationId: s.locationId,
      characterIds: (s.characterIdsJson ?? []) as string[],
      narrative: s.narrative,
      duration: s.duration,
      camera: s.cameraJson,
      continuity: s.continuityJson,
      timeline: s.timelineJson ?? undefined,
      environment: s.environmentJson ?? undefined,
    }))

    const normalizedCharacters: NormalizedCharacter[] = detail.characters.map(c => ({
      id: c.id,
      name: c.name,
      identityPrompt: c.identityPrompt ?? '',
      negativePrompt: c.negativePrompt ?? '',
    }))

    const normalizedLocations: NormalizedLocation[] = detail.locations.map((l) => {
      const cameraRules = l.profileJson?.cameraRules
      return {
        id: l.id,
        name: l.name,
        scenePrompt: l.scenePrompt ?? '',
        negativePrompt: l.negativePrompt ?? '',
        cameraRules: cameraRules ?? { axisDirection: '', allowedAngles: [] as string[], forbiddenAngles: [] as string[] },
      }
    })

    const issues = validateShotContinuity({
      shots: normalizedShots,
      characters: normalizedCharacters,
      locations: normalizedLocations,
    })

    await createContinuityReport({
      projectId,
      issuesJson: issues,
    })

    notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues }, undefined, runId)
    await updateCanvasProject(projectId, { status: 'continuity_checked' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'continuity', issuesFound: issues.length })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(accountId, projectId, 'continuity', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}

/**
 * 阶段 8：重建视频提示词
 *
 * 遍历每个镜头，根据角色 identityPrompt + 场景 scenePrompt + camera +
 * continuity + timeline + environment 组装 videoPrompt 和 negativePrompt。
 * 成功后项目状态变为 'prompts_ready'，镜头状态变为 'ready'。
 */
export async function rebuildShotPrompts(projectId: string, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

  if (runId)
    await markPipelineRunRunning(runId)

  try {
    const characterMap = new Map(detail.characters.map(c => [c.id, c]))
    const locationMap = new Map(detail.locations.map(l => [l.id, l]))

    for (const shot of detail.shots) {
      const shotCharacters = shot.characterIdsJson
        .map(id => characterMap.get(id))
        .filter(Boolean) as typeof detail.characters

      const shotLocation = shot.locationId ? locationMap.get(shot.locationId) : undefined

      if (!shotLocation)
        continue

      const { videoPrompt, negativePrompt } = buildShotVideoPrompt({
        shot: {
          id: shot.id,
          shotIndex: shot.shotIndex,
          locationId: shot.locationId,
          characterIds: shot.characterIdsJson,
          narrative: shot.narrative,
          camera: shot.cameraJson,
          continuity: shot.continuityJson,
          timeline: shot.timelineJson ?? undefined,
          environment: shot.environmentJson ?? undefined,
          duration: shot.duration,
        },
        characters: shotCharacters.map(c => ({
          id: c.id,
          name: c.name,
          identityPrompt: c.identityPrompt ?? '',
          negativePrompt: c.negativePrompt ?? '',
        })),
        location: {
          id: shotLocation.id,
          name: shotLocation.name,
          scenePrompt: shotLocation.scenePrompt ?? '',
          negativePrompt: shotLocation.negativePrompt ?? '',
          cameraRules: shotLocation.profileJson?.cameraRules ?? { axisDirection: '', allowedAngles: [] as string[], forbiddenAngles: [] as string[] },
        },
        timeline: shot.timelineJson ?? undefined,
        environment: shot.environmentJson ?? undefined,
      })

      await updateCanvasShot(shot.id, {
        videoPrompt,
        negativePrompt,
        status: 'ready',
      })
    }

    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    notifyNode(accountId, projectId, 'prompts', projectId, 'completed', undefined, undefined, runId)
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'rebuild' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(accountId, projectId, 'rebuild', projectId, 'failed', undefined, (error as Error).message, runId)
    if (runId)
      await markPipelineRunFailed(runId, (error as Error).message)
    throw error
  }
}

/**
 * 阶段 9：提交视频生成任务
 *
 * 为每个有 videoPrompt 的镜头提交异步视频生成任务：
 *   1. 收集角色+场景参考图作为 referenceUrls
 *   2. 根据 referenceUrls 选择 r2v/t2v 模型变体
 *   3. 调用 provider 提交任务，获取 providerTaskId
 *   4. 创建 generation_record 跟踪费用
 *   5. 镜头状态变为 'generating'
 *
 * 项目保持 'generating' 状态，Worker 轮询完成后通过
 * reconcileProjectShots() 自动将项目和镜头标记完成。
 */
export async function generateVideos(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const accountId = detail.project.accountId
  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  if (runId)
    await markPipelineRunRunning(runId)

  await updateCanvasProject(projectId, { status: 'generating' })

  let hasAnyVideo = false

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running', undefined, undefined, runId)

    try {
      // Collect reference images from characters AND location for visual consistency
      const charRefUrls = shot.characterIdsJson
        .map(id => characterMap.get(id)?.referenceImageUrl)
        .filter(Boolean) as string[]
      const locRefUrl = shot.locationId
        ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
        : null
      const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

      const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
      const videoParams = {
        prompt: shot.videoPrompt.slice(0, 2500),
        negative_prompt: shot.negativePrompt || '',
        resolution: '720P',
        duration: shot.duration,
      }

      const submitResult = await client.submitVideoTaskWithFallback(
        model,
        videoParams,
        referenceUrls.length > 0 ? referenceUrls : undefined,
      )

      if (!submitResult.success || !submitResult.taskId) {
        await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
        notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, submitResult.error, runId)
        continue
      }

      await updateCanvasShot(shot.id, {
        videoTaskId: submitResult.taskId,
        status: 'generating',
      })
      hasAnyVideo = true

      const usedModelConfig = getModelById(submitResult.model)!
      const inputParams = { source: 'canvas', projectId, shotId: shot.id, prompt: shot.videoPrompt, resolution: '720P', duration: shot.duration }
      const cost = calculateCost(usedModelConfig, inputParams)
      await createGenerationRecord({
        accountId,
        taskId: submitResult.taskId!,
        model: submitResult.model,
        category: 'video',
        status: 'processing',
        inputParams,
        cost,
      })
    }
    catch (error) {
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: (error as Error).message })
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, (error as Error).message, runId)
    }
  }

  if (hasAnyVideo) {
    // 保持 generating 状态，等待 worker 轮询完所有 shot 后再标记完成
    // reconcileProjectShots() 会在所有 shot 完成后自动将项目标记为 completed
    await updateCanvasProject(projectId, { status: 'generating' })
    if (runId)
      await markPipelineRunSucceeded(runId, { phase: 'videos', shotsSubmitted: detail.shots.filter(s => s.videoPrompt).length })
  }
  else {
    // All submissions failed — revert to prompts_ready so user can retry
    await updateCanvasProject(projectId, { status: 'prompts_ready' })
    if (runId)
      await markPipelineRunFailed(runId, '所有视频提交失败')
  }

  return getProjectDetail(projectId)
}

// ===== 资源 PATCH =====

/** 更新项目模型偏好（textModel/imageModel/videoModel） */
export async function updateModelPreferences(projectId: string, prefs: CanvasModelPreferences) {
  await updateCanvasProject(projectId, {
    modelPreferencesJson: prefs,
  })
  return getProjectDetail(projectId)
}

export async function updateCharacterData(characterId: string, patch: {
  name?: string
  role?: string
  description?: string
  identityPrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}) {
  return updateCanvasCharacter(characterId, patch)
}

export async function updateLocationData(locationId: string, patch: {
  name?: string
  type?: string
  scenePrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}) {
  return updateCanvasLocation(locationId, patch)
}

export async function updateShotData(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: ShotCamera
  environmentJson?: ShotEnvironment
  videoPrompt?: string
}) {
  return updateCanvasShot(shotId, patch)
}

/** 删除角色 — 先清理引用该角色的镜头（移除 characterIds 中的引用），再删除角色本身 */
export async function deleteCharacter(characterId: string) {
  // Clean up shots referencing this character before deleting
  const shots = await listCanvasShotsByProject(
    (await getCanvasCharacterById(characterId))?.projectId ?? '',
  )
  const characterIdStr = characterId
  for (const shot of shots) {
    if (shot.characterIdsJson.includes(characterIdStr)) {
      const updatedIds = shot.characterIdsJson.filter(id => id !== characterIdStr)
      await updateCanvasShot(shot.id, { characterIdsJson: updatedIds })
    }
  }
  await deleteCanvasCharacterById(characterId)
}

/** 删除场景 — 先清理引用该场景的镜头（清空 locationId），再删除场景本身 */
export async function deleteLocation(locationId: string) {
  // Clean up shots referencing this location before deleting
  const shots = await listCanvasShotsByProject(
    (await getCanvasLocationById(locationId))?.projectId ?? '',
  )
  for (const shot of shots) {
    if (shot.locationId === locationId) {
      await updateCanvasShot(shot.id, { locationId: undefined })
    }
  }
  await deleteCanvasLocationById(locationId)
}

export async function deleteShot(shotId: string) {
  await deleteCanvasShotById(shotId)
}

/** 重试单个失败镜头 — 重置为 draft 后重新提交视频生成任务 */
export async function retryShotVideo(shotId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const shot = await getCanvasShotById(shotId)
  if (!shot)
    throw new Error('镜头不存在')
  if (shot.status !== 'failed')
    throw new Error('只能重试失败的镜头')

  // Reset shot to draft state
  await resetCanvasShotToDraft(shotId)

  // Re-run generateVideos for just this single shot
  const detail = await getCanvasProjectDetail(shot.projectId)
  if (!detail)
    throw new Error('项目不存在')

  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  await updateCanvasProject(shot.projectId, { status: 'generating' })

  notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'running')

  const charRefUrls = shot.characterIdsJson
    .map(id => characterMap.get(id)?.referenceImageUrl)
    .filter(Boolean) as string[]
  const locRefUrl = shot.locationId
    ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
    : null
  const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

  const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
  const videoParams = {
    prompt: shot.videoPrompt!.slice(0, 2500),
    negative_prompt: shot.negativePrompt || '',
    resolution: '720P',
    duration: shot.duration,
  }

  const submitResult = await client.submitVideoTaskWithFallback(
    model,
    videoParams,
    referenceUrls.length > 0 ? referenceUrls : undefined,
  )

  if (!submitResult.success || !submitResult.taskId) {
    await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
    notifyNode(detail.project.accountId, shot.projectId, 'shot', shot.id, 'failed', undefined, submitResult.error)
    throw new Error(submitResult.error)
  }

  await updateCanvasShot(shot.id, { videoTaskId: submitResult.taskId, status: 'generating' })

  const usedModelConfig = getModelById(submitResult.model)!
  const inputParams = { source: 'canvas', projectId: shot.projectId, shotId, prompt: shot.videoPrompt, resolution: '720P', duration: shot.duration }
  const cost = calculateCost(usedModelConfig, inputParams)
  await createGenerationRecord({
    accountId: detail.project.accountId,
    taskId: submitResult.taskId,
    model: submitResult.model,
    category: 'video',
    status: 'processing',
    inputParams,
    cost: { ...cost, estimated: true },
  })
}

/**
 * 批量重试项目中所有失败的镜头。
 * 将项目设回 generating，对每个失败镜头执行 resetCanvasShotToDraft + 重新提交视频任务。
 */
export async function retryFailedShots(projectId: string, accountId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const failedShots = detail.shots.filter(s => s.status === 'failed')
  if (failedShots.length === 0)
    throw new Error('没有失败的镜头可以重试')

  await updateCanvasProject(projectId, { status: 'generating' })

  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  for (const shot of failedShots) {
    await resetCanvasShotToDraft(shot.id)
    notifyNode(accountId, projectId, 'shot', shot.id, 'running')

    const charRefUrls = shot.characterIdsJson
      .map((id: string) => characterMap.get(id)?.referenceImageUrl)
      .filter(Boolean) as string[]
    const locRefUrl = shot.locationId
      ? locationMap.get(shot.locationId)?.referenceImageUrl ?? null
      : null
    const referenceUrls = [...charRefUrls, ...(locRefUrl ? [locRefUrl] : [])]

    const model = getVideoModel(detail.project.modelPreferencesJson, referenceUrls)
    const videoParams = {
      prompt: shot.videoPrompt!.slice(0, 2500),
      negative_prompt: shot.negativePrompt || '',
      resolution: '720P',
      duration: shot.duration,
    }

    const submitResult = await client.submitVideoTaskWithFallback(
      model,
      videoParams,
      referenceUrls.length > 0 ? referenceUrls : undefined,
    )

    if (!submitResult.success || !submitResult.taskId) {
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: submitResult.error })
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, submitResult.error)
      continue
    }

    await updateCanvasShot(shot.id, { videoTaskId: submitResult.taskId, status: 'generating' })

    const usedModelConfig = getModelById(submitResult.model)!
    const inputParams = { source: 'canvas', projectId, shotId: shot.id, prompt: shot.videoPrompt, resolution: '720P', duration: shot.duration }
    const cost = calculateCost(usedModelConfig, inputParams)
    await createGenerationRecord({
      accountId,
      taskId: submitResult.taskId,
      model: submitResult.model,
      category: 'video',
      status: 'processing',
      inputParams,
      cost: { ...cost, estimated: true },
    })
  }
}
