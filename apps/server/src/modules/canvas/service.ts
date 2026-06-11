import type { ShotCamera, ShotEnvironment } from '@excuse/db'
import type { CanvasModelPreferences, CharacterProfile, LocationProfile, NovelAnalysis, ShotDraft } from '@excuse/shared'
import type { OSSConfig } from '@excuse/provider'
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

function createClient(config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  return new DashScopeClient({ apiKey: config.dashscopeApiKey, baseUrl: config.dashscopeBaseUrl })
}

function notifyNode(accountId: string, projectId: string, nodeType: string, nodeId: string, status: 'running' | 'completed' | 'failed', data?: Record<string, unknown>, error?: string) {
  dispatchToUser(accountId, 'pipeline_node_update', { projectId, nodeType, nodeId, status, data, error })
}

const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'
const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro'

function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

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

export async function createProject(accountId: string, input: { title?: string, storyText: string }) {
  const project = await createCanvasProject({
    accountId,
    title: input.title ?? null,
    storyText: input.storyText,
    status: 'draft',
  })
  return mapProjectDetail(project, [], [], [], null)
}

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
      const hasFailed = updatedShots.some(s => s.status === 'failed')
      // 全部成功 → completed；存在失败 → 仍标记 completed 但前端可区分
      await updateCanvasProject(projectId, { status: 'completed' })
      if (hasFailed) {
        // 通知前端存在失败镜头，但项目整体视为完成（允许重试单个镜头）
      }
    }
  }
}

export async function getProjectDetail(projectId: string) {
  const project = await getCanvasProjectById(projectId)
  if (project && (project.status === 'generating' || project.status === 'refs_all_ready'))
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

export async function saveCanvasLayout(projectId: string, layout: Record<string, unknown>) {
  return updateCanvasProject(projectId, { canvasLayout: layout })
}

// ===== 流水线步骤 =====

/** 流水线状态守卫：防止对正在 generating 的项目重复触发 */
function assertNotGenerating(status: string | null | undefined): void {
  if (status === 'generating') {
    throw new Error('项目正在生成中，请等待完成后再操作')
  }
}

export async function analyzeProject(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  notifyNode(project.accountId, projectId, 'analysis', projectId, 'running')

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

    notifyNode(project.accountId, projectId, 'analysis', projectId, 'completed', { analysis })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(project.accountId, projectId, 'analysis', projectId, 'failed', undefined, (error as Error).message)
    throw error
  }
}

export async function generateCharacters(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  // Characters changed → downstream storyboard references become stale
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  const created = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running')

    try {
      const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
        notifyNode(accountId, projectId, 'character', name, 'failed', undefined, result.error)
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

      notifyNode(accountId, projectId, 'character', character.id, 'completed', { name: profile.name, profile })
      created.push(character)
    }
    catch (error) {
      notifyNode(accountId, projectId, 'character', name, 'failed', undefined, (error as Error).message)
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })
  return getProjectDetail(projectId)
}

export async function generateLocations(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertNotGenerating(project.status)

  const analysis = project.analysisJson!
  const accountId = project.accountId

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })
  // Locations changed → downstream storyboard references become stale
  await deleteCanvasShotsByProject(projectId)

  const client = createClient(config)
  const textModel = getTextModel(project.modelPreferencesJson)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running')

    try {
      const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion(textModel, {
        prompt: `${system}\n\n${userPrompt}`,
        max_tokens: 4096,
        temperature: 0.7,
      })

      if (!result.success || !result.output) {
        notifyNode(accountId, projectId, 'location', name, 'failed', undefined, result.error)
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

      notifyNode(accountId, projectId, 'location', name, 'completed', { name: profile.name, profile })
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', name, 'failed', undefined, (error as Error).message)
    }
  }

  await updateCanvasProject(projectId, { status: 'locations_ready' })
  return getProjectDetail(projectId)
}

export async function generateCharacterRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)

  for (const char of detail.characters) {
    if (char.locked || !char.identityPrompt || char.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'character', char.id, 'running')

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

      notifyNode(accountId, projectId, 'character', char.id, 'completed')
    }
    catch (error) {
      notifyNode(accountId, projectId, 'character', char.id, 'failed', undefined, (error as Error).message)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })
  return getProjectDetail(projectId)
}

export async function generateLocationRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)

  for (const loc of detail.locations) {
    if (loc.locked || !loc.scenePrompt || loc.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'location', loc.id, 'running')

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

      notifyNode(accountId, projectId, 'location', loc.id, 'completed')
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', loc.id, 'failed', undefined, (error as Error).message)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })
  return getProjectDetail(projectId)
}

export async function generateStoryboard(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const analysis = project.analysisJson!
  const accountId = project.accountId

  notifyNode(accountId, projectId, 'storyboard', projectId, 'running')

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
      notifyNode(accountId, projectId, 'shot', shot.id, 'completed')
    }

    await updateCanvasProject(projectId, { status: 'storyboard_ready' })
    return getProjectDetail(projectId)
  }
  catch (error) {
    await updateCanvasProject(projectId, { status: 'failed' })
    notifyNode(accountId, projectId, 'storyboard', projectId, 'failed', undefined, (error as Error).message)
    throw error
  }
}

export async function checkContinuity(projectId: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId

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

  notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues })
  await updateCanvasProject(projectId, { status: 'continuity_checked' })
  return getProjectDetail(projectId)
}

export async function rebuildShotPrompts(projectId: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const accountId = detail.project.accountId
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
  notifyNode(accountId, projectId, 'prompts', projectId, 'completed')
  return getProjectDetail(projectId)
}

export async function generateVideos(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const accountId = detail.project.accountId
  const client = createClient(config)
  const characterMap = new Map(detail.characters.map(c => [c.id, c]))
  const locationMap = new Map(detail.locations.map(l => [l.id, l]))

  await updateCanvasProject(projectId, { status: 'generating' })

  let hasAnyVideo = false

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running')

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
        notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, submitResult.error)
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
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, (error as Error).message)
    }
  }

  if (hasAnyVideo) {
    // 保持 generating 状态，等待 worker 轮询完所有 shot 后再标记完成
    // reconcileProjectShots() 会在所有 shot 完成后自动将项目标记为 completed
    await updateCanvasProject(projectId, { status: 'generating' })
  }
  else {
    // All submissions failed — revert to prompts_ready so user can retry
    await updateCanvasProject(projectId, { status: 'prompts_ready' })
  }

  return getProjectDetail(projectId)
}

// ===== 资源 PATCH =====

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
