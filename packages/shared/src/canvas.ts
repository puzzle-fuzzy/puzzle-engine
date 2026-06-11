import type { ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry } from '@excuse/db'
// ===== 画布流水线领域类型 =====

/** 用户可选择的模型类别偏好 */
export interface CanvasModelPreferences {
  textModel?: string
  imageModel?: string
  videoModel?: string
}

/** 画布项目状态 */
export type CanvasProjectStatus
  = | 'draft' | 'analyzed' | 'characters_ready' | 'locations_ready'
    | 'refs_ready' | 'refs_all_ready' | 'storyboard_ready' | 'continuity_checked'
    | 'prompts_ready' | 'generating' | 'completed' | 'failed'

/** 画布镜头状态 */
export type CanvasShotStatus = 'draft' | 'ready' | 'generating' | 'completed' | 'failed'

// ===== LLM 输出类型 =====

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

/** 分镜草稿（LLM 输出） */
export interface ShotDraft {
  shotIndex: number
  duration: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  camera: { shotSize: string, angle: string, movement: string, lens: string }
  continuity: {
    screenDirection: string
    characterFacing: Record<string, string>
    actionStart: string
    actionEnd: string
    emotionStart: string
    emotionEnd: string
  }
  timeline?: Array<{ time: string, action: string }>
  environment?: { backgroundMotion?: string, lighting?: string, mood?: string, style?: string }
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

// ===== SSE 事件 =====

/** 流水线节点 SSE 事件 */
export interface SSEPipelineNodeEvent {
  projectId: string
  nodeType: string
  nodeId: string
  status: 'running' | 'completed' | 'failed'
  data?: Record<string, unknown>
  error?: string
}

// ===== DTO 类型（API 响应） =====

export interface CharacterDTO {
  id: string
  projectId: string
  name: string
  role: string | null
  description: string | null
  profile: CharacterProfile | null
  identityPrompt: string | null
  negativePrompt: string | null
  referenceImageUrl: string | null
  turnaroundSheetUrl: string | null
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface LocationDTO {
  id: string
  projectId: string
  name: string
  type: string
  profile: LocationProfile | null
  scenePrompt: string | null
  negativePrompt: string | null
  referenceImageUrl: string | null
  locked: boolean
  createdAt: string
  updatedAt: string
}

export interface ShotDTO {
  id: string
  projectId: string
  shotIndex: number
  duration: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  camera: ShotCamera
  continuity: ShotContinuity
  timeline: ShotTimelineEntry[] | null
  environment: ShotEnvironment | null
  videoPrompt: string | null
  negativePrompt: string | null
  videoTaskId: string | null
  videoUrl: string | null
  status: CanvasShotStatus
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDTO {
  id: string
  accountId: string
  title: string | null
  storyText: string
  status: CanvasProjectStatus
  analysis: NovelAnalysis | null
  modelPreferences: CanvasModelPreferences | null
  characters: CharacterDTO[]
  locations: LocationDTO[]
  shots: ShotDTO[]
  continuityIssues: ContinuityIssue[]
  canvasLayout: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
}
