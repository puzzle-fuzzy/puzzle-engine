/**
 * 连续性校验器 — 规则引擎（不调用 LLM）
 *
 * 检测相邻镜头间的连续性问题，包括：
 *   - 缺失场景/角色引用 (error)
 *   - 禁止的摄影角度 (error)
 *   - 180 度规则违反 — 角色朝向突变 (warning)
 *   - 动作不连续 — 前一镜头结束动作 ≠ 下一镜头开始动作 (warning)
 *   - 情绪不连续 (warning)
 *
 * 返回 ContinuityIssue[] 数组，每个 issue 包含：
 *   severity: 'error' | 'warning'
 *   code: 问题类型标识
 *   message: 人类可读描述
 *   suggestion: 修复建议
 */
import type { ContinuityIssue, ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry } from '@excuse/shared'

/** 标准化镜头数据 — 从 DB row 映射为校验器所需的统一结构 */
export interface NormalizedShot {
  id: string
  shotIndex: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  duration: number
  camera: ShotCamera
  continuity: ShotContinuity
  timeline?: ShotTimelineEntry[]
  environment?: ShotEnvironment
}

/** 标准化角色数据 — 校验器用于角色名映射和 identity 验证 */
export interface NormalizedCharacter {
  id: string
  name: string
  identityPrompt: string
  negativePrompt: string
}

/** 标准化场景数据 — 校验器用于 cameraRules 检查 */
export interface NormalizedLocation {
  id: string
  name: string
  scenePrompt: string
  negativePrompt: string
  cameraRules: {
    axisDirection: string
    allowedAngles: string[]
    forbiddenAngles: string[]
  }
}

/**
 * 执行连续性校验
 *
 * 校验分两轮：
 *   1. 逐镜头：检查缺失引用、禁止角度
 *   2. 逐对相邻镜头（同一场景内）：检查朝向、动作、情绪连续性
 */
export function validateShotContinuity(args: {
  shots: NormalizedShot[]
  characters: NormalizedCharacter[]
  locations: NormalizedLocation[]
}): ContinuityIssue[] {
  const { shots, characters, locations } = args
  const issues: ContinuityIssue[] = []

  const characterIds = new Set(characters.map(c => c.id))
  const locationIds = new Set(locations.map(l => l.id))
  const locationMap = new Map(locations.map(l => [l.id, l]))
  const idToName = new Map(characters.map(c => [c.id, c.name]))

  for (const shot of shots) {
    if (shot.locationId && !locationIds.has(shot.locationId)) {
      issues.push({
        severity: 'error',
        shotId: shot.id,
        shotIndex: shot.shotIndex,
        code: 'MISSING_SCENE',
        message: `镜头 ${shot.shotIndex} 引用了不存在的场景 ID: ${shot.locationId}`,
        suggestion: '请检查场景库，确保所有镜头都引用有效场景',
      })
    }

    if (shot.characterIds.length === 0) {
      issues.push({
        severity: 'error',
        shotId: shot.id,
        shotIndex: shot.shotIndex,
        code: 'MISSING_CHARACTER',
        message: `镜头 ${shot.shotIndex} 没有关联任何角色`,
        suggestion: '请至少为每个镜头指定一个角色',
      })
    }

    for (const charId of shot.characterIds) {
      if (!characterIds.has(charId)) {
        issues.push({
          severity: 'error',
          shotId: shot.id,
          shotIndex: shot.shotIndex,
          code: 'MISSING_CHARACTER',
          message: `镜头 ${shot.shotIndex} 引用了不存在的角色 ID: ${charId}`,
          suggestion: '请检查角色库，确保所有镜头都引用有效角色',
        })
      }
    }

    if (shot.locationId) {
      const location = locationMap.get(shot.locationId)
      if (location && location.cameraRules.forbiddenAngles.length > 0) {
        if (location.cameraRules.forbiddenAngles.includes(shot.camera.angle)) {
          issues.push({
            severity: 'error',
            shotId: shot.id,
            shotIndex: shot.shotIndex,
            code: 'FORBIDDEN_CAMERA_ANGLE',
            message: `镜头 ${shot.shotIndex} 的摄影机角度 "${shot.camera.angle}" 在场景 "${location.name}" 中被禁止`,
            suggestion: `该场景允许的角度：${location.cameraRules.allowedAngles.join('、')}`,
          })
        }
      }
    }
  }

  for (let i = 1; i < shots.length; i++) {
    const prev = shots[i - 1]
    const curr = shots[i]

    if (prev.locationId !== curr.locationId)
      continue

    const prevFacings = prev.continuity.characterFacing
    const currFacings = curr.continuity.characterFacing

    for (const charKey of Object.keys(prevFacings)) {
      if (
        currFacings[charKey]
        && prevFacings[charKey] !== currFacings[charKey]
        && prev.continuity.screenDirection === curr.continuity.screenDirection
      ) {
        const charName = idToName.get(charKey) || charKey
        issues.push({
          severity: 'warning',
          shotId: curr.id,
          shotIndex: curr.shotIndex,
          code: 'FACING_CHANGE',
          message: `角色"${charName}"在镜头 ${prev.shotIndex}→${curr.shotIndex} 朝向从 "${prevFacings[charKey]}" 变为 "${currFacings[charKey]}"，可能违反180度规则`,
          suggestion: '请确认朝向变化是否有剧情原因，或调整镜头轴线',
        })
      }
    }

    if (
      prev.continuity.actionEnd
      && curr.continuity.actionStart
      && prev.continuity.actionEnd !== curr.continuity.actionStart
    ) {
      const normalize = (s: string) => s.replace(/[，。、！？\s]/g, '').slice(0, 10)
      if (normalize(prev.continuity.actionEnd) !== normalize(curr.continuity.actionStart)) {
        issues.push({
          severity: 'warning',
          shotId: curr.id,
          shotIndex: curr.shotIndex,
          code: 'ACTION_MISMATCH',
          message: `镜头 ${prev.shotIndex}→${curr.shotIndex} 动作不连续："${prev.continuity.actionEnd}" → "${curr.continuity.actionStart}"`,
          suggestion: '请确保前一镜头的结束动作与下一镜头的开始动作一致',
        })
      }
    }

    if (
      prev.continuity.emotionEnd
      && curr.continuity.emotionStart
      && prev.continuity.emotionEnd !== curr.continuity.emotionStart
    ) {
      issues.push({
        severity: 'warning',
        shotId: curr.id,
        shotIndex: curr.shotIndex,
        code: 'EMOTION_MISMATCH',
        message: `镜头 ${prev.shotIndex}→${curr.shotIndex} 情绪不连续："${prev.continuity.emotionEnd}" → "${curr.continuity.emotionStart}"`,
        suggestion: '请确保前一镜头的结束情绪与下一镜头的开始情绪一致',
      })
    }
  }

  return issues
}
