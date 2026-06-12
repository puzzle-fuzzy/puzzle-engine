import type { OSSConfig } from '@excuse/provider'
import {
  getCanvasProjectDetail,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  updateCanvasCharacter,
  updateCanvasLocation,
  updateCanvasProject,
} from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
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
