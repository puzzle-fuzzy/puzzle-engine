import { describe, expect, it } from 'bun:test'
import {
  CanvasSchemaError,
  validateCharacterProfile,
  validateLocationProfile,
  validateNovelAnalysis,
  validateShotDrafts,
} from '../src'

describe('validateNovelAnalysis', () => {
  it('passes through a well-formed analysis', () => {
    const input = {
      summary: '一个故事',
      mainConflict: '主角对抗反派',
      timeline: ['开端', '高潮'],
      characterNames: ['小明', '小红'],
      sceneNames: ['王城', '森林'],
    }
    expect(validateNovelAnalysis(input)).toEqual(input)
  })

  it('throws when root is not an object', () => {
    expect(() => validateNovelAnalysis('nope')).toThrow(CanvasSchemaError)
    expect(() => validateNovelAnalysis(null)).toThrow(CanvasSchemaError)
  })

  it('throws when a required string field is missing or wrong type', () => {
    expect(() => validateNovelAnalysis({ mainConflict: 'x' })).toThrow(CanvasSchemaError)
    expect(() => validateNovelAnalysis({ summary: 42, mainConflict: 'x' })).toThrow(CanvasSchemaError)
  })

  it('defaults missing arrays to []', () => {
    const result = validateNovelAnalysis({ summary: 's', mainConflict: 'c' })
    expect(result.timeline).toEqual([])
    expect(result.characterNames).toEqual([])
    expect(result.sceneNames).toEqual([])
  })
})

describe('validateCharacterProfile', () => {
  const valid = {
    name: '小明',
    role: '主角',
    age: '20',
    gender: '男',
    bodyShape: '瘦',
    height: '175',
    face: { shape: '圆', eyes: '大', eyebrows: '粗', nose: '挺', mouth: '小', skin: '白' },
    hair: { color: '黑', style: '短', length: '短' },
    costume: { mainColor: '蓝', style: '便装', material: '棉', details: ['腰带'] },
    accessories: ['剑'],
    identityPrompt: '一个少年',
    negativePrompt: '畸形',
  }

  it('passes through a well-formed profile', () => {
    expect(validateCharacterProfile(valid)).toEqual(valid)
  })

  it('throws when root is not an object', () => {
    expect(() => validateCharacterProfile([])).toThrow(CanvasSchemaError)
  })

  it('throws when name or identityPrompt is missing', () => {
    expect(() => validateCharacterProfile({ ...valid, name: undefined })).toThrow(CanvasSchemaError)
    expect(() => validateCharacterProfile({ ...valid, identityPrompt: 1 })).toThrow(CanvasSchemaError)
  })

  it('defaults missing nested objects and optional fields', () => {
    const result = validateCharacterProfile({ name: '小明', identityPrompt: '少年' })
    expect(result.role).toBe('')
    expect(result.face).toEqual({ shape: '', eyes: '', eyebrows: '', nose: '', mouth: '', skin: '' })
    expect(result.hair).toEqual({ color: '', style: '', length: '' })
    expect(result.costume).toEqual({ mainColor: '', style: '', material: '', details: [] })
    expect(result.accessories).toEqual([])
    expect(result.negativePrompt).toBe('')
  })

  it('filters non-string entries out of arrays', () => {
    const result = validateCharacterProfile({ ...valid, accessories: ['剑', 9, null] })
    expect(result.accessories).toEqual(['剑'])
  })
})

describe('validateLocationProfile', () => {
  const valid = {
    name: '王城',
    type: 'exterior',
    location: '城门口',
    era: '古代',
    atmosphere: '庄严',
    visualRules: { colorPalette: ['灰'], lighting: '强', architecture: '中式', floor: '石', backgroundElements: ['旗'] },
    cameraRules: { axisDirection: '左', allowedAngles: ['平'], forbiddenAngles: ['俯'] },
    scenePrompt: '一座城',
    negativePrompt: '现代',
  }

  it('passes through a well-formed profile', () => {
    expect(validateLocationProfile(valid)).toEqual(valid)
  })

  it('throws when name or scenePrompt is missing', () => {
    expect(() => validateLocationProfile({ ...valid, name: undefined })).toThrow(CanvasSchemaError)
    expect(() => validateLocationProfile({ scenePrompt: 'x' })).toThrow(CanvasSchemaError)
  })

  it('coerces an invalid type to mixed', () => {
    const result = validateLocationProfile({ ...valid, type: 'underwater' })
    expect(result.type).toBe('mixed')
  })

  it('defaults missing nested structures', () => {
    const result = validateLocationProfile({ name: '王城', scenePrompt: '一座城' })
    expect(result.visualRules.colorPalette).toEqual([])
    expect(result.cameraRules).toEqual({ axisDirection: '', allowedAngles: [], forbiddenAngles: [] })
    expect(result.type).toBe('mixed')
  })
})

describe('validateShotDrafts', () => {
  const shot = {
    shotIndex: 0,
    duration: 3,
    locationId: 'loc-1',
    characterIds: ['char-1'],
    narrative: '小明走进城',
    camera: { shotSize: '全景', angle: '平', movement: '推', lens: '35mm' },
    continuity: { screenDirection: '左', characterFacing: { char1: '右' }, actionStart: '走', actionEnd: '停', emotionStart: '平静', emotionEnd: '紧张' },
    timeline: [{ time: '0s', action: '走' }],
    environment: { lighting: '日', mood: '平静' },
  }

  it('passes through a well-formed shot array', () => {
    expect(validateShotDrafts([shot])).toEqual([shot])
  })

  it('throws when input is not an array', () => {
    expect(() => validateShotDrafts({})).toThrow(CanvasSchemaError)
  })

  it('throws on an empty array', () => {
    expect(() => validateShotDrafts([])).toThrow(CanvasSchemaError)
  })

  it('throws when a shot is missing narrative', () => {
    expect(() => validateShotDrafts([{ shotIndex: 0 }])).toThrow(CanvasSchemaError)
  })

  it('falls back to array index when shotIndex is missing', () => {
    const [result] = validateShotDrafts([{ narrative: 'x' }, { narrative: 'y' }])
    expect(result.shotIndex).toBe(0)
  })

  it('defaults missing optional/nested fields', () => {
    const [result] = validateShotDrafts([{ narrative: 'x' }])
    expect(result.duration).toBe(0)
    expect(result.locationId).toBeNull()
    expect(result.characterIds).toEqual([])
    expect(result.camera).toEqual({ shotSize: '', angle: '', movement: '', lens: '' })
    expect(result.continuity.characterFacing).toEqual({})
    expect(result.timeline).toBeUndefined()
    expect(result.environment).toBeUndefined()
  })

  it('nulls out a non-string locationId', () => {
    const [result] = validateShotDrafts([{ narrative: 'x', locationId: 42 }])
    expect(result.locationId).toBeNull()
  })
})

describe('CanvasSchemaError', () => {
  it('carries field and reason', () => {
    try {
      validateNovelAnalysis({})
      throw new Error('should have thrown')
    }
    catch (err) {
      expect(err).toBeInstanceOf(CanvasSchemaError)
      const e = err as CanvasSchemaError
      expect(e.field).toBe('analysis.summary')
      expect(e.reason).toContain('字符串')
      expect(e.message).toContain('analysis.summary')
    }
  })
})
