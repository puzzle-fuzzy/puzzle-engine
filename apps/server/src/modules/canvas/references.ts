import type { CanvasAssetOutput } from '@excuse/db'
import type { OSSConfig } from '@excuse/provider'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  setCanvasAssetActive,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
} from '@excuse/db'
import { AssetStorage, getModelById, validateAndMerge } from '@excuse/provider'
import { getProjectDetail } from './service-crud'
import { assertNotGenerating, createClient, getImageModel, notifyNode } from './service-helpers'

export async function generateCharacterRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const char of detail.characters) {
    if (char.locked || !char.identityPrompt || char.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'character', char.id, 'running', undefined, undefined, runId)

    // ── 为角色肖像创建 canvas_asset ──────────────────
    const portraitAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: char.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: `${char.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`, size: '2048*2048', n: 1 },
    })
    // ── 为角色三视图创建 canvas_asset ──────────────────
    const turnaroundAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterTurnaround',
      targetEntityType: 'character',
      targetEntityId: char.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: `${char.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(portraitAsset.id)
      await markCanvasAssetRunning(turnaroundAsset.id)

      const portraitValidation = validateAndMerge(imageModelConfig, {
        prompt: `${char.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`,
        size: '2048*2048',
        n: 1,
      })
      if (!portraitValidation.ok) {
        const detail = portraitValidation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new Error(`参数校验失败：${detail}`)
      }
      const portraitResult = await client.generateImage(imageModel, portraitValidation.params)

      if (portraitResult.success && portraitResult.output) {
        const urls = portraitResult.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${char.id}`, 'portrait')
          const publicUrl = savedUrls[0] || urls[0]
          await updateCanvasCharacter(char.id, { referenceImageUrl: publicUrl })
          // ── 标记肖像资产成功 + 设为活跃 ──────────────
          const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
          await markCanvasAssetSucceeded(portraitAsset.id, outputJson, publicUrl, savedUrls[0] ?? undefined, urls[0], undefined)
          await setCanvasAssetActive(portraitAsset.id)
        }
      }

      const turnaroundValidation = validateAndMerge(imageModelConfig, {
        prompt: `${char.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`,
        size: '2048*2048',
        n: 1,
      })
      if (!turnaroundValidation.ok) {
        const detail = turnaroundValidation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new Error(`参数校验失败：${detail}`)
      }
      const turnaroundResult = await client.generateImage(imageModel, turnaroundValidation.params)

      if (turnaroundResult.success && turnaroundResult.output) {
        const urls = turnaroundResult.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${char.id}`, 'turnaround')
          const publicUrl = savedUrls[0] || urls[0]
          await updateCanvasCharacter(char.id, { turnaroundSheetUrl: publicUrl })
          // ── 标记三视图资产成功 + 设为活跃 ──────────────
          const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
          await markCanvasAssetSucceeded(turnaroundAsset.id, outputJson, publicUrl, savedUrls[0] ?? undefined, urls[0], undefined)
          await setCanvasAssetActive(turnaroundAsset.id)
        }
      }

      notifyNode(accountId, projectId, 'character', char.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      // ── 标记资产失败 ──────────────────────────────────
      const errorMessage = (error as Error).message
      // 尝试标记两个资产为失败（如果它们仍在运行状态）
      await markCanvasAssetFailed(portraitAsset.id, errorMessage).catch(() => {})
      await markCanvasAssetFailed(turnaroundAsset.id, errorMessage).catch(() => {})
      notifyNode(accountId, projectId, 'character', char.id, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'characterRefs' })
  return getProjectDetail(projectId)
}

export async function generateLocationRefs(projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss?: OSSConfig }, runId?: string) {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertNotGenerating(detail.project.status)

  const client = createClient(config)
  const storage = new AssetStorage({ storageRoot: config.storageRoot, oss: config.oss })
  const accountId = detail.project.accountId
  const imageModel = getImageModel(detail.project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  if (runId)
    await markPipelineRunRunning(runId)

  for (const loc of detail.locations) {
    if (loc.locked || !loc.scenePrompt || loc.referenceImageUrl)
      continue

    notifyNode(accountId, projectId, 'location', loc.id, 'running', undefined, undefined, runId)

    // ── 为场景参考图创建 canvas_asset ──────────────────
    const refAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'locationRef',
      targetEntityType: 'location',
      targetEntityId: loc.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: `${loc.scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(refAsset.id)

      const refValidation = validateAndMerge(imageModelConfig, {
        prompt: `${loc.scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`,
        size: '2048*2048',
        n: 1,
      })
      if (!refValidation.ok) {
        const detail = refValidation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        throw new Error(`参数校验失败：${detail}`)
      }
      const result = await client.generateImage(imageModel, refValidation.params)

      if (result.success && result.output) {
        const urls = result.output.urls
        if (Array.isArray(urls) && urls.length) {
          const savedUrls = await storage.downloadAndMap(urls as string[], `canvas/${loc.id}`, 'ref')
          const publicUrl = savedUrls[0] || urls[0]
          await updateCanvasLocation(loc.id, { referenceImageUrl: publicUrl })
          // ── 标记参考图资产成功 + 设为活跃 ──────────────
          const outputJson: CanvasAssetOutput = { type: 'image', urls: savedUrls.length > 0 ? savedUrls : urls }
          await markCanvasAssetSucceeded(refAsset.id, outputJson, publicUrl, savedUrls[0] ?? undefined, urls[0], undefined)
          await setCanvasAssetActive(refAsset.id)
        }
      }

      notifyNode(accountId, projectId, 'location', loc.id, 'completed', undefined, undefined, runId)
    }
    catch (error) {
      // ── 标记资产失败 ──────────────────────────────────
      const errorMessage = (error as Error).message
      await markCanvasAssetFailed(refAsset.id, errorMessage).catch(() => {})
      notifyNode(accountId, projectId, 'location', loc.id, 'failed', undefined, errorMessage, runId)
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_all_ready' })
  if (runId)
    await markPipelineRunSucceeded(runId, { phase: 'locationRefs' })
  return getProjectDetail(projectId)
}
