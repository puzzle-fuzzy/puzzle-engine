import type {
  CanvasModelPreferences,
  CharacterProfile,
  ContinuityIssue,
  LocationProfile,
  NovelAnalysis,
  ShotCamera,
  ShotContinuity,
  ShotEnvironment,
  ShotTimelineEntry,
} from '@excuse/db'

// 域类型从 @excuse/db import type 重导出（编译期擦除，零运行时影响）
export type { CanvasModelPreferences, NovelAnalysis, CharacterProfile, LocationProfile, ContinuityIssue }
export type { ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry }

// ===== 画布流水线领域类型 =====

/** 画布项目状态 */
export type CanvasProjectStatus
  = | 'draft' | 'analyzed' | 'characters_ready' | 'locations_ready'
    | 'refs_ready' | 'refs_all_ready' | 'storyboard_ready' | 'continuity_checked'
    | 'prompts_ready' | 'generating' | 'completed' | 'failed'

/** 画布镜头状态 */
export type CanvasShotStatus = 'draft' | 'ready' | 'generating' | 'completed' | 'failed'

// ===== LLM 输出类型 =====
// NovelAnalysis / CharacterProfile / LocationProfile / ContinuityIssue 已从 @excuse/db 重导出

/** 分镜草稿（LLM 输出） */
export interface ShotDraft {
  shotIndex: number
  duration: number
  locationId: string | null
  characterIds: string[]
  narrative: string
  camera: ShotCamera
  continuity: ShotContinuity
  timeline?: ShotTimelineEntry[]
  environment?: ShotEnvironment
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
