import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import type { CanvasAssetOutput } from '@excuse/db'
import type { CanvasModelPreferences } from '@excuse/shared'
import type { WorkerConfig } from './config'
import {
  createCanvasAsset,
  getCanvasProjectDetail,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  markCanvasAssetSucceeded,
  setCanvasAssetActive,
} from '@excuse/db'
import { DashScopeClient } from '@excuse/provider'

type CanvasProjectDetail = NonNullable<Awaited<ReturnType<typeof getCanvasProjectDetail>>>
type CreateCanvasAssetInput = Parameters<typeof createCanvasAsset>[0]
const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'

export function createDashScopeClient(workerConfig: WorkerConfig): DashScopeClient {
  return new DashScopeClient({
    apiKey: workerConfig.dashscopeApiKey,
    baseUrl: workerConfig.dashscopeBaseUrl,
  })
}

export function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

export async function loadRunnableCanvasProject(projectId: string): Promise<CanvasProjectDetail> {
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    throw new Error('项目不存在')
  assertCanvasProjectNotGenerating(detail.project.status)
  return detail
}

export function assertCanvasProjectNotGenerating(status: string | null | undefined): void {
  if (status === 'generating')
    throw new Error('项目正在生成中，请等待完成后再操作')
}

export async function runCanvasAssetStep<T>(args: {
  asset: CreateCanvasAssetInput
  execute: (assetId: string) => Promise<{ result: T, output: CanvasAssetOutput }>
  setActive?: boolean
}): Promise<T> {
  const asset = await createCanvasAsset(args.asset)

  try {
    await markCanvasAssetRunning(asset.id)
    const { result, output } = await args.execute(asset.id)
    await markCanvasAssetSucceeded(asset.id, output)
    if (args.setActive ?? true)
      await setCanvasAssetActive(asset.id)
    return result
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await markCanvasAssetFailed(asset.id, errorMessage).catch(() => {})
    throw error
  }
}

export function toNormalizedShot(shot: CanvasProjectDetail['shots'][number]): NormalizedShot {
  return {
    id: shot.id,
    shotIndex: shot.shotIndex,
    locationId: shot.locationId,
    characterIds: (shot.characterIdsJson ?? []) as string[],
    narrative: shot.narrative,
    duration: shot.duration,
    camera: shot.cameraJson,
    continuity: shot.continuityJson,
    timeline: shot.timelineJson ?? undefined,
    environment: shot.environmentJson ?? undefined,
  }
}

export function toNormalizedCharacter(character: CanvasProjectDetail['characters'][number]): NormalizedCharacter {
  return {
    id: character.id,
    name: character.name,
    identityPrompt: character.identityPrompt ?? '',
    negativePrompt: character.negativePrompt ?? '',
  }
}

export function toNormalizedLocation(location: CanvasProjectDetail['locations'][number]): NormalizedLocation {
  const cameraRules = location.profileJson?.cameraRules
  return {
    id: location.id,
    name: location.name,
    scenePrompt: location.scenePrompt ?? '',
    negativePrompt: location.negativePrompt ?? '',
    cameraRules: cameraRules ?? { axisDirection: '', allowedAngles: [], forbiddenAngles: [] },
  }
}
