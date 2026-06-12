import type {
  CanvasLayoutDto as CanvasLayoutDtoFromDB,
  CanvasLayoutEdge,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutViewport,
  CanvasModelPreferences,
  CanvasProjectStatus as CanvasProjectStatusFromDB,
  CanvasShotStatus as CanvasShotStatusFromDB,
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
export type { CanvasModelPreferences, CharacterProfile, ContinuityIssue, LocationProfile, NovelAnalysis }
export type { ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry }
export type { CanvasLayoutEdge, CanvasLayoutNode, CanvasLayoutPosition, CanvasLayoutViewport }
export type CanvasLayoutDto = CanvasLayoutDtoFromDB

// ===== 画布状态类型（从 DB pgEnum 推导，消除重复定义） =====

/** 画布项目状态（从 pgEnum 推导，与数据库枚举保持同步） */
export type CanvasProjectStatus = CanvasProjectStatusFromDB

/** 画布镜头状态（从 pgEnum 推导，与数据库枚举保持同步） */
export type CanvasShotStatus = CanvasShotStatusFromDB

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
  runId?: string
  data?: Record<string, unknown>
  error?: string
}

/** fire-and-forget 类接口的统一受理响应 */
export interface AcceptedResponse {
  accepted: true
  runId?: string
}

// ===== 画布布局类型（前端 UI 状态，后端不解释） =====

// ===== SSE 事件 =====

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
  type: LocationProfile['type']
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
  canvasLayout: CanvasLayoutDto | null
  createdAt: string
  updatedAt: string
}
