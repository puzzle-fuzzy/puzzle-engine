import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import type { CanvasModelPreferences } from '@excuse/shared'
import type { WorkerConfig } from './config'
import { getCanvasVideoModel } from '@excuse/canvas-runtime'
import {
  getCanvasProjectDetail,
} from '@excuse/db'
import { DashScopeClient } from '@excuse/provider'

type CanvasProjectDetail = NonNullable<Awaited<ReturnType<typeof getCanvasProjectDetail>>>
const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'
const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro'

export function createDashScopeClient(workerConfig: WorkerConfig): DashScopeClient {
  return new DashScopeClient({
    apiKey: workerConfig.dashscopeApiKey,
    baseUrl: workerConfig.dashscopeBaseUrl,
  })
}

export function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

export function getImageModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.imageModel || DEFAULT_IMAGE_MODEL
}

export function getVideoModel(prefs: CanvasModelPreferences | null | undefined, referenceUrls: string[]): string {
  return getCanvasVideoModel(prefs, referenceUrls)
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
