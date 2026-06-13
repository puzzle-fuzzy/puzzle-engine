import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from '@excuse/canvas-engine'
import { buildShotVideoPrompt } from '@excuse/prompt-engine'
import { describe, expect, it } from 'bun:test'

function makeShot(overrides: Partial<NormalizedShot> = {}): NormalizedShot {
  return {
    id: 'shot-1',
    shotIndex: 1,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: 'A girl walks through the forest',
    duration: 5,
    camera: { shotSize: 'medium', angle: 'front', movement: 'slow dolly in', lens: '35mm' },
    continuity: {
      screenDirection: 'left_to_right',
      characterFacing: { 'char-1': 'right' },
      actionStart: 'standing',
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
    identityPrompt: 'A young woman with long black hair, wearing a red dress',
    negativePrompt: 'blurry, deformed',
    ...overrides,
  }
}

function makeLocation(overrides: Partial<NormalizedLocation> = {}): NormalizedLocation {
  return {
    id: 'loc-1',
    name: 'Dark Forest',
    scenePrompt: 'A mysterious dark forest with tall ancient trees',
    negativePrompt: 'bright, sunny',
    cameraRules: {
      axisDirection: 'left_to_right',
      allowedAngles: ['front', 'side'],
      forbiddenAngles: [],
    },
    ...overrides,
  }
}

describe('buildShotVideoPrompt', () => {
  it('should include character consistency section', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Character consistency:')
    expect(result.videoPrompt).toContain('Alice')
    expect(result.videoPrompt).toContain('A young woman with long black hair, wearing a red dress')
  })

  it('should include scene consistency section', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Scene consistency:')
    expect(result.videoPrompt).toContain('A mysterious dark forest with tall ancient trees')
  })

  it('should include narrative', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('A girl walks through the forest')
  })

  it('should include camera section', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Shot size: medium')
    expect(result.videoPrompt).toContain('Angle: front')
    expect(result.videoPrompt).toContain('Movement: slow dolly in')
    expect(result.videoPrompt).toContain('Lens: 35mm')
  })

  it('should include emotion continuity', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Start emotion: calm')
    expect(result.videoPrompt).toContain('End emotion: determined')
  })

  it('should include character facing section', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Alice: facing right')
  })

  it('should include environment section when provided', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
      environment: {
        backgroundMotion: 'gentle wind',
        lighting: 'moonlight',
        mood: 'mysterious',
        style: 'cinematic',
      },
    })
    expect(result.videoPrompt).toContain('Background motion: gentle wind')
    expect(result.videoPrompt).toContain('Lighting: moonlight')
    expect(result.videoPrompt).toContain('Mood: mysterious')
    expect(result.videoPrompt).toContain('Style: cinematic')
  })

  it('should not include environment section when omitted', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).not.toContain('Background motion:')
  })

  it('should include timeline from shot when provided', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
      timeline: [
        { time: '0s-1s', action: 'standing still' },
        { time: '1s-2s', action: 'takes first step' },
      ],
    })
    expect(result.videoPrompt).toContain('Frame-by-frame timeline (total 5s):')
  })

  it('should include quality requirements', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('character appearance consistency')
    expect(result.videoPrompt).toContain('180-degree axis')
  })

  it('should handle multiple characters', () => {
    const char2: NormalizedCharacter = {
      id: 'char-2',
      name: 'Bob',
      identityPrompt: 'A tall man with glasses',
      negativePrompt: 'cartoonish',
    }
    const shot = makeShot({ characterIds: ['char-1', 'char-2'] })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter(), char2],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('Alice')
    expect(result.videoPrompt).toContain('Bob')
  })

  // ── negativePrompt ────────────────────────────────

  it('should combine character and location negative prompts', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.negativePrompt).toContain('blurry, deformed')
    expect(result.negativePrompt).toContain('bright, sunny')
  })

  it('should include default quality negatives', () => {
    const result = buildShotVideoPrompt({
      shot: makeShot(),
      characters: [makeCharacter({ negativePrompt: '' })],
      location: makeLocation({ negativePrompt: '' }),
    })
    expect(result.negativePrompt).toContain('distorted faces')
    expect(result.negativePrompt).toContain('watermark')
  })

  it('should use default duration of 5 when not specified', () => {
    const shot = makeShot({ duration: 0 })
    const result = buildShotVideoPrompt({
      shot,
      characters: [makeCharacter()],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('total 5s')
  })

  it('should use character ID as fallback name in facing section', () => {
    const shot = makeShot({
      characterIds: ['unknown-id'],
      continuity: {
        screenDirection: 'left_to_right',
        characterFacing: { 'unknown-id': 'left' },
        actionStart: 'standing',
        actionEnd: 'walking',
        emotionStart: 'calm',
        emotionEnd: 'calm',
      },
    })
    const result = buildShotVideoPrompt({
      shot,
      characters: [],
      location: makeLocation(),
    })
    expect(result.videoPrompt).toContain('unknown-id: facing left')
  })
})
