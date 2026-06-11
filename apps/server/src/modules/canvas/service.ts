import type { CharacterProfile, LocationProfile, NovelAnalysis, ShotDraft } from '@excuse/shared'
import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from './continuity'
import { calculateCost } from '@excuse/billing'
import {
  batchCreateCanvasShots,
  createCanvasCharacter,
  createCanvasLocation,
  createCanvasProject,
  createContinuityReport,
  createGenerationRecord,
  deleteCanvasCharactersByProject,
  deleteCanvasLocationsByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  getCanvasProjectDetail,
  listCanvasProjectsByAccount,
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

export async function getProjectDetail(projectId: string) {
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

export async function analyzeProject(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  notifyNode(project.accountId, projectId, 'analysis', projectId, 'running')

  try {
    const client = createClient(config)
    const { system, prompt: userPrompt } = buildAnalysisPrompt(project.storyText)

    const result = await client.chatCompletion('qwen-max', {
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
      analysisJson: analysis as unknown as Record<string, unknown>,
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

  const analysis = project.analysisJson as unknown as NovelAnalysis
  const accountId = project.accountId

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })

  const client = createClient(config)

  const created = []
  for (const name of analysis.characterNames) {
    notifyNode(accountId, projectId, 'character', name, 'running')

    try {
      const { system, prompt: userPrompt } = buildCharacterPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion('qwen-max', {
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
        profileJson: profile as unknown as Record<string, unknown>,
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

  const analysis = project.analysisJson as unknown as NovelAnalysis
  const accountId = project.accountId

  await deleteCanvasLocationsByProject(projectId, { excludeLocked: true })

  const client = createClient(config)

  for (const name of analysis.sceneNames) {
    notifyNode(accountId, projectId, 'location', name, 'running')

    try {
      const { system, prompt: userPrompt } = buildLocationPrompt(project.storyText, analysis, name)
      const result = await client.chatCompletion('qwen-max', {
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
        profileJson: profile as unknown as Record<string, unknown>,
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

export async function generateCharacterRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: any }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId

  for (const char of detail.characters) {
    if (char.locked || char.identityPrompt)
      continue

    notifyNode(accountId, projectId, 'character', char.id, 'running')

    try {
      const portraitResult = await client.generateImage('qwen-image-2.0-pro', {
        prompt: `${char.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`,
        size: '1024*1024',
        n: 1,
      })

      if (portraitResult.success && (portraitResult.output as any)?.urls?.length) {
        const urls = (portraitResult.output as any).urls as string[]
        const savedUrls = await storage.downloadAndMap(urls, `canvas/${char.id}`, 'portrait')
        await updateCanvasCharacter(char.id, { referenceImageUrl: savedUrls[0] || urls[0] })
      }

      const turnaroundResult = await client.generateImage('qwen-image-2.0-pro', {
        prompt: `${char.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`,
        size: '1024*1024',
        n: 1,
      })

      if (turnaroundResult.success && (turnaroundResult.output as any)?.urls?.length) {
        const urls = (turnaroundResult.output as any).urls as string[]
        const savedUrls = await storage.downloadAndMap(urls, `canvas/${char.id}`, 'turnaround')
        await updateCanvasCharacter(char.id, { turnaroundSheetUrl: savedUrls[0] || urls[0] })
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

export async function generateLocationRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: any }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId

  for (const loc of detail.locations) {
    if (loc.locked || !loc.scenePrompt || loc.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'location', loc.id, 'running')

    try {
      const result = await client.generateImage('qwen-image-2.0-pro', {
        prompt: `${loc.scenePrompt}, establishing shot, wide angle, cinematic lighting`,
        size: '1024*1024',
        n: 1,
      })

      if (result.success && (result.output as any)?.urls?.length) {
        const urls = (result.output as any).urls as string[]
        const savedUrls = await storage.downloadAndMap(urls, `canvas/${loc.id}`, 'ref')
        await updateCanvasLocation(loc.id, { referenceImageUrl: savedUrls[0] || urls[0] })
      }

      notifyNode(accountId, projectId, 'location', loc.id, 'completed')
    }
    catch (error) {
      notifyNode(accountId, projectId, 'location', loc.id, 'failed', undefined, (error as Error).message)
    }
  }

  return getProjectDetail(projectId)
}

export async function generateStoryboard(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

  const project = detail.project
  if (!project.analysisJson)
    throw new Error('项目未分析')

  const analysis = project.analysisJson as unknown as NovelAnalysis
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

    const result = await client.chatCompletion('qwen-max', {
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
      cameraJson: shot.camera as unknown as Record<string, unknown>,
      continuityJson: shot.continuity as unknown as Record<string, unknown>,
      timelineJson: shot.timeline ?? null,
      environmentJson: shot.environment ? shot.environment as unknown as Record<string, unknown> : null,
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

  const accountId = detail.project.accountId

  const normalizedShots: NormalizedShot[] = detail.shots.map((s): NormalizedShot => ({
    id: s.id,
    shotIndex: s.shotIndex,
    locationId: s.locationId,
    characterIds: (s.characterIdsJson ?? []) as string[],
    narrative: s.narrative,
    duration: s.duration,
    camera: (s.cameraJson ?? {}) as NormalizedShot['camera'],
    continuity: (s.continuityJson ?? {}) as NormalizedShot['continuity'],
    timeline: (s.timelineJson ?? undefined) as NormalizedShot['timeline'],
    environment: (s.environmentJson ?? undefined) as NormalizedShot['environment'],
  }))

  const normalizedCharacters: NormalizedCharacter[] = detail.characters.map(c => ({
    id: c.id,
    name: c.name,
    identityPrompt: c.identityPrompt ?? '',
    negativePrompt: c.negativePrompt ?? '',
  }))

  const normalizedLocations: NormalizedLocation[] = detail.locations.map((l) => {
    const profile = l.profileJson as any
    return {
      id: l.id,
      name: l.name,
      scenePrompt: l.scenePrompt ?? '',
      negativePrompt: l.negativePrompt ?? '',
      cameraRules: profile?.cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
    }
  })

  const issues = validateShotContinuity({
    shots: normalizedShots,
    characters: normalizedCharacters,
    locations: normalizedLocations,
  })

  await createContinuityReport({
    projectId,
    issuesJson: issues as unknown as Record<string, unknown>[],
  })

  notifyNode(accountId, projectId, 'continuity', projectId, 'completed', { issues })
  await updateCanvasProject(projectId, { status: 'continuity_checked' })
  return getProjectDetail(projectId)
}

export async function rebuildShotPrompts(projectId: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')

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
        camera: shot.cameraJson as NormalizedShot['camera'],
        continuity: shot.continuityJson as NormalizedShot['continuity'],
        timeline: shot.timelineJson ?? undefined,
        environment: shot.environmentJson as NormalizedShot['environment'],
        duration: shot.duration,
      } as NormalizedShot,
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
        cameraRules: (shotLocation.profileJson as any)?.cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
      },
      timeline: shot.timelineJson ?? undefined,
      environment: shot.environmentJson as NormalizedShot['environment'],
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

  await updateCanvasProject(projectId, { status: 'generating' })

  for (const shot of detail.shots) {
    if (!shot.videoPrompt)
      continue

    notifyNode(accountId, projectId, 'shot', shot.id, 'running')

    try {
      const referenceUrls = shot.characterIdsJson
        .map(id => characterMap.get(id)?.referenceImageUrl)
        .filter(Boolean) as string[]

      const model = referenceUrls.length > 0 ? 'happyhorse-1.0-r2v' : 'happyhorse-1.0-t2v'
      const modelConfig = getModelById(model)
      const fallbackId = modelConfig?.fallbackModel

      const result = await client.submitVideoTask(model, {
        prompt: shot.videoPrompt.slice(0, 2500),
        negative_prompt: shot.negativePrompt || '',
        resolution: '720P',
        duration: shot.duration,
      }, referenceUrls.length > 0 ? referenceUrls : undefined)

      let actualModel = model
      let actualTaskId = result.providerTaskId
      let actualSuccess = result.success

      if (!result.success || !result.providerTaskId) {
        // Try declarative fallback model
        if (fallbackId) {
          const fallbackResult = await client.submitVideoTask(fallbackId, {
            prompt: shot.videoPrompt.slice(0, 2500),
            negative_prompt: shot.negativePrompt || '',
            resolution: '720P',
            duration: shot.duration,
          })

          if (fallbackResult.success && fallbackResult.providerTaskId) {
            actualModel = fallbackId
            actualTaskId = fallbackResult.providerTaskId
            actualSuccess = true
          }
        }

        if (!actualSuccess || !actualTaskId) {
          await updateCanvasShot(shot.id, { status: 'failed', errorMessage: result.error || '视频提交失败' })
          notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, result.error)
          continue
        }
      }

      await updateCanvasShot(shot.id, {
        videoTaskId: actualTaskId,
        status: 'generating',
      })

      const usedModelConfig = getModelById(actualModel)!
      const cost = calculateCost(usedModelConfig, { duration: shot.duration })
      await createGenerationRecord({
        accountId,
        taskId: actualTaskId!,
        model: actualModel,
        category: 'video',
        status: 'processing',
        inputParams: { source: 'canvas', projectId, shotId: shot.id, prompt: shot.videoPrompt },
        cost,
      })
    }
    catch (error) {
      await updateCanvasShot(shot.id, { status: 'failed', errorMessage: (error as Error).message })
      notifyNode(accountId, projectId, 'shot', shot.id, 'failed', undefined, (error as Error).message)
    }
  }

  return getProjectDetail(projectId)
}

// ===== 资源 PATCH =====

export async function updateCharacterData(characterId: string, patch: { identityPrompt?: string, negativePrompt?: string, locked?: boolean }) {
  return updateCanvasCharacter(characterId, patch)
}

export async function updateLocationData(locationId: string, patch: { scenePrompt?: string, negativePrompt?: string, locked?: boolean }) {
  return updateCanvasLocation(locationId, patch)
}

export async function updateShotData(shotId: string, patch: { narrative?: string, videoPrompt?: string }) {
  return updateCanvasShot(shotId, patch)
}
