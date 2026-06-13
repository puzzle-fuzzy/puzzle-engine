import type {
  CanvasLayoutDto as CanvasLayoutDtoFromDB,
  CanvasLayoutEdge,
  CanvasLayoutNode,
  CanvasLayoutPosition,
  CanvasLayoutViewport,
  CanvasModelPreferences,
  CanvasPipelineRunRow,
  CanvasProjectStatus as CanvasProjectStatusFromDB,
  CanvasShotStatus as CanvasShotStatusFromDB,
  CharacterProfile,
  ContinuityIssue,
  LocationProfile,
  NovelAnalysis,
  Serialize,
  ShotCamera,
  ShotContinuity,
  ShotEnvironment,
  ShotTimelineEntry,
} from '@excuse/db'
import type { EntityResponse, ListResponse, MutationOkResponse } from './api-response'
import type { CanvasFailureKind } from './canvas-failure'

// 域类型从 @excuse/db import type 重导出（编译期擦除，零运行时影响）
export type { CanvasModelPreferences, CharacterProfile, ContinuityIssue, LocationProfile, NovelAnalysis }
export type { ShotCamera, ShotContinuity, ShotEnvironment, ShotTimelineEntry }
export type { CanvasLayoutEdge, CanvasLayoutNode, CanvasLayoutPosition, CanvasLayoutViewport }
export type CanvasLayoutDto = CanvasLayoutDtoFromDB
export type CanvasPipelineRunDTO = Serialize<CanvasPipelineRunRow>

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
  /** SSE 管道节点不透明数据 — 存储边界：不同 nodeType 产生不同 data 形状，backend 不解读 */
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

export type CanvasProjectResponse = EntityResponse<ProjectDTO>

export type CanvasProjectListResponse = ListResponse<ProjectDTO>

export type CanvasPipelineRunResponse = EntityResponse<CanvasPipelineRunDTO>

export type CanvasPipelineRunListResponse = ListResponse<CanvasPipelineRunDTO>

export type CanvasCharacterResponse = EntityResponse<CharacterDTO>

export type CanvasLocationResponse = EntityResponse<LocationDTO>

export type CanvasShotResponse = EntityResponse<ShotDTO>

export type CanvasMutationOkResponse = MutationOkResponse

// ===== 资产轮询类型 =====

/** Canvas 资产轮询响应 — 项目资产和任务状态的一次性快照 */
export interface CanvasAssetsPoll {
  scope: 'canvas'
  projectId: string
  projectStatus: CanvasProjectStatus

  /** 角色 — 当前参考图和活跃生成任务 */
  characters: Array<{
    characterId: string
    name: string
    referenceImageUrl: string | null
    turnaroundSheetUrl: string | null
    /** 当前活跃的图片生成 canvas_asset ID（从 canvas_assets 表中 queued/running 状态匹配） */
    activeImageTaskIds: string[]
  }>

  /** 场景 — 当前参考图和活跃生成任务 */
  locations: Array<{
    locationId: string
    name: string
    referenceImageUrl: string | null
    /** 当前活跃的图片生成 canvas_asset ID（从 canvas_assets 表中 queued/running 状态匹配） */
    activeImageTaskIds: string[]
  }>

  /** 镜头 — 当前视频 URL 和活跃生成任务 */
  shots: Array<{
    shotId: string
    shotIndex: number
    status: CanvasShotStatus
    videoUrl: string | null
    /** 当前活跃的视频生成任务 ID（从 generation_records 中 status 非终态匹配 shotId） */
    activeVideoTaskIds: string[]
  }>

  /** 项目下所有活跃（非终态）的生成任务（来自 generation_records + canvas_assets） */
  activeTasks: Array<{
    id: string
    category: 'text' | 'image' | 'video'
    status: string
    /** 任务目标实体 ID */
    targetId: string
    /** 任务目标实体类型 */
    targetType: 'character' | 'location' | 'shot' | 'project'
    /** 失败时的错误信息（重试中的任务可能携带上一次失败原因） */
    errorMessage?: string | null
    /** 重试次数（仅 generation_records 有此字段；canvas_assets 为 null） */
    retryCount?: number | null
    /** 任务最后更新时间（epoch ms），用于任务队列面板展示 */
    updatedAt?: number | null
  }>

  /**
   * 项目下最近的失败任务（failed/cancelled 状态）
   * — 用于任务队列面板的失败原因与下一步建议展示
   * 来自 generation_records + canvas_assets 的终态记录，按 updatedAt 倒序，限制 20 条
   */
  recentFailures: Array<{
    id: string
    category: 'text' | 'image' | 'video'
    status: string
    targetId: string
    targetType: 'character' | 'location' | 'shot' | 'project'
    errorMessage: string | null
    retryCount: number
    /** 分类后的失败类型（balance/content/network/storage/cancel/provider/system） */
    failureKind: CanvasFailureKind
    /** 下一步建议 */
    suggestion: string
    /** 失败时间（epoch ms） */
    failedAt: number | null
  }>

  /** 项目下所有生成记录的成本快照（来自 generation_records + canvas_assets） */
  costs: Array<{
    recordId: string
    category: 'text' | 'image' | 'video'
    /** cost state: active(进行中) | completed(已成功) | failed(已失败/取消) */
    state: 'active' | 'completed' | 'failed'
    estimatedCostCents: number | null
    finalCostCents: number | null
  }>

  /** 服务器生成此快照的时间戳（epoch ms），前端判断数据新鲜度 */
  generatedAt: number
}

export type CanvasAssetsPollResponse = EntityResponse<CanvasAssetsPoll>
