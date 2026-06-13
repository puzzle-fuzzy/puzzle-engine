import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '../src'
import { describe, expect, it } from 'bun:test'
import { validateShotContinuity } from '../src'

function makeShot(overrides: Partial<NormalizedShot> = {}): NormalizedShot {
  return {
    id: 'shot-1',
    shotIndex: 1,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: 'A character walks',
    duration: 5,
    camera: { shotSize: 'medium', angle: 'front', movement: 'static', lens: '35mm' },
    continuity: {
      screenDirection: 'left_to_right',
      characterFacing: { 'char-1': 'right' },
      actionStart: 'standing still',
      actionEnd: 'walking',
      emotionStart: 'calm',
      emotionEnd: 'determined',
    },
    ...overrides,
  }
}

function makeCharacter(overrides: Partial<NormalizedCharacter> = {}): NormalizedCharacter {
  return {
    id: 'char-1',
    name: 'Alice',
    identityPrompt: 'A young woman',
    negativePrompt: 'blurry',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<NormalizedLocation> = {}): NormalizedLocation {
  return {
    id: 'loc-1',
    name: 'Forest',
    scenePrompt: 'A dark forest',
    negativePrompt: 'bright',
    cameraRules: {
      axisDirection: 'left_to_right',
      allowedAngles: ['front', 'side'],
      forbiddenAngles: [],
    },
    ...overrides,
  }
}

describe('validateShotContinuity', () => {
  it('should return no issues for valid shots', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing still',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'determined',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'determined',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(0)
  })

  it('should return no issues for empty shots', () => {
    const issues = validateShotContinuity({
      shots: [],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(0)
  })

  // ── MISSING_SCENE ──────────────────────────────────

  it('should detect MISSING_SCENE for invalid locationId', () => {
    const shot = makeShot({ locationId: 'nonexistent-loc' })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'MISSING_SCENE',
      shotId: 'shot-1',
      shotIndex: 1,
    })
  })

  it('should not flag null locationId', () => {
    const shot = makeShot({ locationId: null })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const sceneIssues = issues.filter(i => i.code === 'MISSING_SCENE')
    expect(sceneIssues).toHaveLength(0)
  })

  // ── MISSING_CHARACTER ─────────────────────────────

  it('should detect MISSING_CHARACTER when no characters assigned', () => {
    const shot = makeShot({ characterIds: [] })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const charIssues = issues.filter(i => i.code === 'MISSING_CHARACTER')
    expect(charIssues).toHaveLength(1)
    expect(charIssues[0]).toMatchObject({
      severity: 'error',
      shotId: 'shot-1',
      message: expect.stringContaining('没有关联任何角色'),
    })
  })

  it('should detect MISSING_CHARACTER for invalid characterId', () => {
    const shot = makeShot({ characterIds: ['char-1', 'nonexistent'] })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const charIssues = issues.filter(i => i.code === 'MISSING_CHARACTER')
    expect(charIssues).toHaveLength(1)
    expect(charIssues[0]?.message).toContain('nonexistent')
  })

  // ── FORBIDDEN_CAMERA_ANGLE ────────────────────────

  it('should detect FORBIDDEN_CAMERA_ANGLE', () => {
    const location = makeLocation({
      cameraRules: {
        axisDirection: 'left_to_right',
        allowedAngles: ['front'],
        forbiddenAngles: ['back'],
      },
    })
    const shot = makeShot({
      camera: { shotSize: 'medium', angle: 'back', movement: 'static', lens: '35mm' },
    })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [location],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      code: 'FORBIDDEN_CAMERA_ANGLE',
      message: expect.stringContaining('back'),
    })
  })

  it('should not flag when angle is allowed', () => {
    const location = makeLocation({
      cameraRules: {
        axisDirection: 'left_to_right',
        allowedAngles: ['front'],
        forbiddenAngles: ['back'],
      },
    })
    const shot = makeShot({
      camera: { shotSize: 'medium', angle: 'front', movement: 'static', lens: '35mm' },
    })
    const issues = validateShotContinuity({
      shots: [shot],
      characters: [makeCharacter()],
      locations: [location],
    })
    expect(issues.filter(i => i.code === 'FORBIDDEN_CAMERA_ANGLE')).toHaveLength(0)
  })

  // ── FACING_CHANGE ─────────────────────────────────

  it('should detect FACING_CHANGE for same-scene consecutive shots', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const facingIssues = issues.filter(i => i.code === 'FACING_CHANGE')
    expect(facingIssues).toHaveLength(1)
    expect(facingIssues[0]).toMatchObject({
      severity: 'warning',
      shotId: 's2',
      message: expect.stringContaining('Alice'),
    })
  })

  it('should not flag FACING_CHANGE when screen direction changes', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'right_to_left',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'FACING_CHANGE')).toHaveLength(0)
  })

  it('should skip FACING_CHANGE for different scenes', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        locationId: 'loc-1',
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        locationId: 'loc-2',
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'left' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation({ id: 'loc-1' }), makeLocation({ id: 'loc-2' })],
    })
    expect(issues.filter(i => i.code === 'FACING_CHANGE')).toHaveLength(0)
  })

  // ── ACTION_MISMATCH ───────────────────────────────

  it('should detect ACTION_MISMATCH for same-scene shots', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking slowly',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'running fast',
          actionEnd: 'sprinting',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const actionIssues = issues.filter(i => i.code === 'ACTION_MISMATCH')
    expect(actionIssues).toHaveLength(1)
    expect(actionIssues[0]).toMatchObject({
      severity: 'warning',
      shotId: 's2',
    })
  })

  it('should not flag ACTION_MISMATCH when actions are consistent', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'ACTION_MISMATCH')).toHaveLength(0)
  })

  it('should tolerate punctuation differences in action matching', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking，slowly',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walkingslowly',
          actionEnd: 'running',
          emotionStart: 'calm',
          emotionEnd: 'calm',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'ACTION_MISMATCH')).toHaveLength(0)
  })

  // ── EMOTION_MISMATCH ──────────────────────────────

  it('should detect EMOTION_MISMATCH for same-scene shots', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'happy',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'sad',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    const emotionIssues = issues.filter(i => i.code === 'EMOTION_MISMATCH')
    expect(emotionIssues).toHaveLength(1)
    expect(emotionIssues[0]).toMatchObject({
      severity: 'warning',
      message: expect.stringContaining('happy'),
    })
  })

  it('should not flag EMOTION_MISMATCH when emotions match', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'standing',
          actionEnd: 'walking',
          emotionStart: 'calm',
          emotionEnd: 'determined',
        },
      }),
      makeShot({
        id: 's2',
        shotIndex: 2,
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: { 'char-1': 'right' },
          actionStart: 'walking',
          actionEnd: 'running',
          emotionStart: 'determined',
          emotionEnd: 'angry',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.filter(i => i.code === 'EMOTION_MISMATCH')).toHaveLength(0)
  })

  // ── Multiple issues combined ──────────────────────

  it('should detect multiple issue types across shots', () => {
    const shots = [
      makeShot({
        id: 's1',
        shotIndex: 1,
        locationId: 'bad-loc',
        characterIds: [],
        continuity: {
          screenDirection: 'left_to_right',
          characterFacing: {},
          actionStart: '',
          actionEnd: '',
          emotionStart: '',
          emotionEnd: '',
        },
      }),
    ]
    const issues = validateShotContinuity({
      shots,
      characters: [makeCharacter()],
      locations: [makeLocation()],
    })
    expect(issues.length).toBeGreaterThanOrEqual(2)
    const codes = issues.map(i => i.code)
    expect(codes).toContain('MISSING_SCENE')
    expect(codes).toContain('MISSING_CHARACTER')
  })
})
