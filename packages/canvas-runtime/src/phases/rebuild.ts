import type { CanvasProjectDetail } from '../normalize'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
import { toNormalizedCharacter, toNormalizedLocation, toNormalizedShot } from '../normalize'

type ShotRow = CanvasProjectDetail['shots'][number]
type CharacterRow = CanvasProjectDetail['characters'][number]
type LocationRow = CanvasProjectDetail['locations'][number]

/**
 * 单镜头 video prompt 构建核心（按镜头循环、纯计算）：buildShotVideoPrompt。
 * 这是 rebuild 阶段的高频漂移片段。host 保留 for…of 循环、runCanvasAssetStep、updateCanvasShot、
 * 计数与 **无 per-shot try/catch**（任一镜头失败即中止整阶段，与原实现一致）。
 *
 * timeline/environment 同时挂在 toNormalizedShot(shot) 内部与顶层参数 —— 与原 server/worker 实现一致，
 * buildShotVideoPrompt 取顶层那份；保持行为不变。
 */
export interface ShotVideoPromptEntityInput {
  shot: ShotRow
  characters: CharacterRow[]
  location: LocationRow
}

export interface ShotVideoPromptEntityResult {
  videoPrompt: string
  negativePrompt: string
}

export function buildShotVideoPromptEntity(input: ShotVideoPromptEntityInput): ShotVideoPromptEntityResult {
  return buildShotVideoPrompt({
    shot: toNormalizedShot(input.shot),
    characters: input.characters.map(toNormalizedCharacter),
    location: toNormalizedLocation(input.location),
    timeline: input.shot.timelineJson ?? undefined,
    environment: input.shot.environmentJson ?? undefined,
  })
}
