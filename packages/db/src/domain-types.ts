// ===== Canvas Domain Types =====
// 纯数据接口，无运行时依赖，供 DB schema $type() 和 @excuse/shared import type 使用

/** 用户可选择的模型类别偏好 */
export interface CanvasModelPreferences {
  textModel?: string
  imageModel?: string
  videoModel?: string
}

/** 故事分析结果 */
export interface NovelAnalysis {
  summary: string
  mainConflict: string
  timeline: string[]
  characterNames: string[]
  sceneNames: string[]
}

/** 角色档案（LLM 输出） */
export interface CharacterProfile {
  name: string
  role: string
  age: string
  gender: string
  bodyShape: string
  height: string
  face: { shape: string, eyes: string, eyebrows: string, nose: string, mouth: string, skin: string }
  hair: { color: string, style: string, length: string }
  costume: { mainColor: string, style: string, material: string, details: string[] }
  accessories: string[]
  identityPrompt: string
  negativePrompt: string
}

/** 场景档案（LLM 输出） */
export interface LocationProfile {
  name: string
  type: 'interior' | 'exterior' | 'mixed'
  location: string
  era: string
  atmosphere: string
  visualRules: {
    colorPalette: string[]
    lighting: string
    architecture: string
    floor: string
    backgroundElements: string[]
  }
  cameraRules: {
    axisDirection: string
    allowedAngles: string[]
    forbiddenAngles: string[]
  }
  scenePrompt: string
  negativePrompt: string
}

/** 镜头摄影参数（从 ShotDraft.camera 提取） */
export interface ShotCamera {
  shotSize: string
  angle: string
  movement: string
  lens: string
}

/** 镜头连续性参数（从 ShotDraft.continuity 提取） */
export interface ShotContinuity {
  screenDirection: string
  characterFacing: Record<string, string>
  actionStart: string
  actionEnd: string
  emotionStart: string
  emotionEnd: string
}

/** 镜头时间线条目（从 ShotDraft.timeline 提取） */
export interface ShotTimelineEntry {
  time: string
  action: string
}

/** 镜头环境参数（从 ShotDraft.environment 提取） */
export interface ShotEnvironment {
  backgroundMotion?: string
  lighting?: string
  mood?: string
  style?: string
}

/** 连续性问题 */
export interface ContinuityIssue {
  severity: 'error' | 'warning'
  shotId?: string
  shotIndex?: number
  code: 'MISSING_SCENE' | 'MISSING_CHARACTER' | 'FORBIDDEN_CAMERA_ANGLE'
    | 'FACING_CHANGE' | 'ACTION_MISMATCH' | 'EMOTION_MISMATCH'
  message: string
  suggestion?: string
}

// ===== Generation Domain Types =====

/**
 * 费用明细（jsonb cost 字段的域类型）
 *  quantity / unitPrice 仅 image/video variant 存在；
 *  token variant 使用 inputUnitPrice / outputUnitPrice / inputCost / outputCost
 */
export interface CostDetail {
  unit: 'token' | 'image' | 'video'
  totalPrice: number
  quantity?: number
  unitPrice?: number
  inputTokens?: number
  outputTokens?: number
  inputUnitPrice?: number
  outputUnitPrice?: number
  inputCost?: number
  outputCost?: number
  resolution?: string
  duration?: number
  estimated?: boolean
}

/** 文本输出 */
export interface TextOutputResult {
  text: string
}

/** 图片输出 */
export interface ImageOutputResult {
  savedUrls: string[]
  urls?: string[]
}

/** 视频输出 */
export interface VideoOutputResult {
  savedUrls: string[]
  originalUrl?: string
  video_url?: string
}

/** 处理中状态（异步任务尚未完成） */
export interface ProcessingOutputResult {
  taskId?: string
  status?: string
}

/** outputResult 的所有可能形态 */
export type OutputResult
  = | TextOutputResult
    | ImageOutputResult
    | VideoOutputResult
    | ProcessingOutputResult
