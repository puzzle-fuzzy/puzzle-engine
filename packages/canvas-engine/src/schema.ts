/**
 * Canvas LLM 输出 schema 校验器（纯函数，不调用 LLM/DB/provider）
 *
 * 配合 `@excuse/prompt-engine` 的 `parseLLMJson` 使用：
 *   parseLLMJson 只保证从 LLM 文本中抠出 JSON，不做字段校验（docstring 明确要求调用方自校验）。
 *   这里的校验器把 `unknown` 收窄为带类型的领域对象，拒绝垃圾数据、补默认值。
 *
 * 校验策略（lenient-tolerant）：
 *   - 直接进入 DB insert / 喂给下游生成器的字段 → 必填，缺失或类型错误抛 CanvasSchemaError
 *   - 描述性 / 嵌套 / 可选字段 → 缺失时填合理默认值，容忍 LLM 正常抖动
 *
 * 参考 `./continuity.ts` 的纯领域函数风格：仅依赖 `@excuse/shared` 类型。
 */
import type {
  CharacterProfile,
  LocationProfile,
  NovelAnalysis,
  ShotCamera,
  ShotContinuity,
  ShotDraft,
  ShotEnvironment,
  ShotTimelineEntry,
} from '@excuse/shared'

/** Canvas LLM 输出不符合 schema 时抛出，携带字段名与原因，便于上游 catch 后回传给用户 */
export class CanvasSchemaError extends Error {
  field: string
  reason: string
  constructor(field: string, reason: string) {
    super(`canvas schema: ${field} ${reason}`)
    this.name = 'CanvasSchemaError'
    this.field = field
    this.reason = reason
  }
}

type Record_ = Record<string, unknown>

function isRecord(v: unknown): v is Record_ {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 必填字符串 — 缺失或非字符串则抛错（空串视为合法，交给 LLM 抖动） */
function requireString(obj: Record_, key: string, field: string): string {
  const v = obj[key]
  if (typeof v !== 'string')
    throw new CanvasSchemaError(field, `应为字符串，实际为 ${typeof v}`)
  return v
}

/** 可选字符串 — 缺失或非字符串时返回默认值 */
function optString(obj: Record_, key: string, def = ''): string {
  const v = obj[key]
  return typeof v === 'string' ? v : def
}

/** 可选字符串数组 — 缺失返回 []；存在则过滤掉非字符串元素 */
function optStringArray(obj: Record_, key: string): string[] {
  const v = obj[key]
  if (!Array.isArray(v))
    return []
  return v.filter((x): x is string => typeof x === 'string')
}

/** 可选数字 — 缺失或非有限数字时返回默认值 */
function optNumber(obj: Record_, key: string, def = 0): number {
  const v = obj[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : def
}

/** 可选对象 — 缺失或非对象时返回 {} */
function optRecord(obj: Record_, key: string): Record_ {
  const v = obj[key]
  return isRecord(v) ? v : {}
}

/** 校验并归一化 NovelAnalysis（小说分析，整个 pipeline 的根） */
export function validateNovelAnalysis(input: unknown): NovelAnalysis {
  if (!isRecord(input))
    throw new CanvasSchemaError('analysis', `应为对象，实际为 ${typeof input}`)

  return {
    summary: requireString(input, 'summary', 'analysis.summary'),
    mainConflict: requireString(input, 'mainConflict', 'analysis.mainConflict'),
    timeline: optStringArray(input, 'timeline'),
    characterNames: optStringArray(input, 'characterNames'),
    sceneNames: optStringArray(input, 'sceneNames'),
  }
}

/** 校验并归一化 CharacterProfile（角色档案） */
export function validateCharacterProfile(input: unknown): CharacterProfile {
  if (!isRecord(input))
    throw new CanvasSchemaError('character', `应为对象，实际为 ${typeof input}`)
  const c = input
  const face = optRecord(c, 'face')
  const hair = optRecord(c, 'hair')
  const costume = optRecord(c, 'costume')

  return {
    name: requireString(c, 'name', 'character.name'),
    role: optString(c, 'role'),
    age: optString(c, 'age'),
    gender: optString(c, 'gender'),
    bodyShape: optString(c, 'bodyShape'),
    height: optString(c, 'height'),
    face: {
      shape: optString(face, 'shape'),
      eyes: optString(face, 'eyes'),
      eyebrows: optString(face, 'eyebrows'),
      nose: optString(face, 'nose'),
      mouth: optString(face, 'mouth'),
      skin: optString(face, 'skin'),
    },
    hair: {
      color: optString(hair, 'color'),
      style: optString(hair, 'style'),
      length: optString(hair, 'length'),
    },
    costume: {
      mainColor: optString(costume, 'mainColor'),
      style: optString(costume, 'style'),
      material: optString(costume, 'material'),
      details: optStringArray(costume, 'details'),
    },
    accessories: optStringArray(c, 'accessories'),
    identityPrompt: requireString(c, 'identityPrompt', 'character.identityPrompt'),
    negativePrompt: optString(c, 'negativePrompt'),
  }
}

/** 校验并归一化 LocationProfile（场景档案） */
export function validateLocationProfile(input: unknown): LocationProfile {
  if (!isRecord(input))
    throw new CanvasSchemaError('location', `应为对象，实际为 ${typeof input}`)
  const l = input
  const visualRules = optRecord(l, 'visualRules')
  const cameraRules = optRecord(l, 'cameraRules')

  const rawType = optString(l, 'type', 'mixed')
  const type: LocationProfile['type']
    = rawType === 'interior' || rawType === 'exterior' || rawType === 'mixed' ? rawType : 'mixed'

  return {
    name: requireString(l, 'name', 'location.name'),
    type,
    location: optString(l, 'location'),
    era: optString(l, 'era'),
    atmosphere: optString(l, 'atmosphere'),
    visualRules: {
      colorPalette: optStringArray(visualRules, 'colorPalette'),
      lighting: optString(visualRules, 'lighting'),
      architecture: optString(visualRules, 'architecture'),
      floor: optString(visualRules, 'floor'),
      backgroundElements: optStringArray(visualRules, 'backgroundElements'),
    },
    cameraRules: {
      axisDirection: optString(cameraRules, 'axisDirection'),
      allowedAngles: optStringArray(cameraRules, 'allowedAngles'),
      forbiddenAngles: optStringArray(cameraRules, 'forbiddenAngles'),
    },
    scenePrompt: requireString(l, 'scenePrompt', 'location.scenePrompt'),
    negativePrompt: optString(l, 'negativePrompt'),
  }
}

/** 校验并归一化单个镜头的摄影参数 */
function normalizeCamera(raw: unknown): ShotCamera {
  const c = isRecord(raw) ? raw : {}
  return {
    shotSize: optString(c, 'shotSize'),
    angle: optString(c, 'angle'),
    movement: optString(c, 'movement'),
    lens: optString(c, 'lens'),
  }
}

/** 校验并归一化单个镜头的连续性参数 */
function normalizeContinuity(raw: unknown): ShotContinuity {
  const c = isRecord(raw) ? raw : {}
  const facing = optRecord(c, 'characterFacing')
  const characterFacing: Record<string, string> = {}
  for (const [k, v] of Object.entries(facing)) {
    if (typeof v === 'string')
      characterFacing[k] = v
  }
  return {
    screenDirection: optString(c, 'screenDirection'),
    characterFacing,
    actionStart: optString(c, 'actionStart'),
    actionEnd: optString(c, 'actionEnd'),
    emotionStart: optString(c, 'emotionStart'),
    emotionEnd: optString(c, 'emotionEnd'),
  }
}

function normalizeTimeline(raw: unknown): ShotTimelineEntry[] | undefined {
  if (!Array.isArray(raw))
    return undefined
  const out: ShotTimelineEntry[] = []
  for (const entry of raw) {
    if (!isRecord(entry))
      continue
    out.push({
      time: optString(entry, 'time'),
      action: optString(entry, 'action'),
    })
  }
  return out.length > 0 ? out : undefined
}

function normalizeEnvironment(raw: unknown): ShotEnvironment | undefined {
  if (!isRecord(raw))
    return undefined
  return {
    backgroundMotion: typeof raw.backgroundMotion === 'string' ? raw.backgroundMotion : undefined,
    lighting: typeof raw.lighting === 'string' ? raw.lighting : undefined,
    mood: typeof raw.mood === 'string' ? raw.mood : undefined,
    style: typeof raw.style === 'string' ? raw.style : undefined,
  }
}

function validateShotDraft(raw: unknown, index: number): ShotDraft {
  if (!isRecord(raw))
    throw new CanvasSchemaError(`shots[${index}]`, `应为对象，实际为 ${typeof raw}`)
  const field = (k: string) => `shots[${index}].${k}`
  return {
    shotIndex: typeof raw.shotIndex === 'number' && Number.isFinite(raw.shotIndex)
      ? raw.shotIndex
      : index,
    duration: optNumber(raw, 'duration'),
    locationId: typeof raw.locationId === 'string' ? raw.locationId : null,
    characterIds: optStringArray(raw, 'characterIds'),
    narrative: requireString(raw, 'narrative', field('narrative')),
    camera: normalizeCamera(raw.camera),
    continuity: normalizeContinuity(raw.continuity),
    timeline: normalizeTimeline(raw.timeline),
    environment: normalizeEnvironment(raw.environment),
  }
}

/** 校验并归一化分镜草案数组（storyboard LLM 输出） */
export function validateShotDrafts(input: unknown): ShotDraft[] {
  if (!Array.isArray(input))
    throw new CanvasSchemaError('shots', `应为数组，实际为 ${typeof input}`)
  if (input.length === 0)
    throw new CanvasSchemaError('shots', '不能为空数组')
  return input.map((shot, i) => validateShotDraft(shot, i))
}
