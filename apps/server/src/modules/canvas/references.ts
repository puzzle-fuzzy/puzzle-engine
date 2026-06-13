import type { OSSConfig } from '@excuse/provider'
import { generateCanvasImageAsset } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
} from '@excuse/db'
import { AssetStorage, getModelById } from '@excuse/provider'
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
    const portraitPrompt = `${char.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`
    const turnaroundPrompt = `${char.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`

    // ── 为角色肖像创建 canvas_asset ──────────────────
    const portraitAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: char.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: portraitPrompt, size: '2048*2048', n: 1 },
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
      inputJson: { prompt: turnaroundPrompt, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(portraitAsset.id)
      await markCanvasAssetRunning(turnaroundAsset.id)

      const portrait = await generateCanvasImageAsset({
        assetId: portraitAsset.id,
        imageModel,
        imageModelConfig,
        prompt: portraitPrompt,
        subDir: `canvas/${char.id}`,
        prefix: 'portrait',
        errorMessage: '角色肖像生成失败',
        client,
        storage,
      })

      if (portrait)
        await updateCanvasCharacter(char.id, { referenceImageUrl: portrait.publicUrl })

      const turnaround = await generateCanvasImageAsset({
        assetId: turnaroundAsset.id,
        imageModel,
        imageModelConfig,
        prompt: turnaroundPrompt,
        subDir: `canvas/${char.id}`,
        prefix: 'turnaround',
        errorMessage: '角色三视图生成失败',
        client,
        storage,
      })

      if (turnaround)
        await updateCanvasCharacter(char.id, { turnaroundSheetUrl: turnaround.publicUrl })

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
    const prompt = `${loc.scenePrompt}, establishing shot, wide angle, cinematic lighting, no people, no characters, empty scene, uninhabited`

    // ── 为场景参考图创建 canvas_asset ──────────────────
    const refAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'locationRef',
      targetEntityType: 'location',
      targetEntityId: loc.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt, size: '2048*2048', n: 1 },
    })

    try {
      // ── 标记资产为运行状态 ──────────────────────────
      await markCanvasAssetRunning(refAsset.id)

      const generated = await generateCanvasImageAsset({
        assetId: refAsset.id,
        imageModel,
        imageModelConfig,
        prompt,
        subDir: `canvas/${loc.id}`,
        prefix: 'ref',
        errorMessage: '场景参考图生成失败',
        client,
        storage,
      })

      if (generated)
        await updateCanvasLocation(loc.id, { referenceImageUrl: generated.publicUrl })

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
