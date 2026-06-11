import type { ContinuityIssue } from '@excuse/shared'

export interface NormalizedShot {
  id: string
  shotIndex: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  duration: number
  camera: { shotSize: string; angle: string; movement: string; lens: string }
  continuity: {
    screenDirection: string
    characterFacing: Record<string, string>
    actionStart: string
    actionEnd: string
    emotionStart: string
    emotionEnd: string
  }
  timeline?: Array<{ time: string; action: string }>
  environment?: { backgroundMotion?: string; lighting?: string; mood?: string; style?: string }
}

export interface NormalizedCharacter {
  id: string
  name: string
  identityPrompt: string
  negativePrompt: string
}

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

    if (prev.locationId !== curr.locationId) continue

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
