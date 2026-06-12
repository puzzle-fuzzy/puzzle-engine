// ===== Canvas Domain Types =====
// 纯数据接口，无运行时依赖，供 DB schema $type() 和 @excuse/shared import type 使用

/**
 * 画布布局 — 前端 React Flow 节点位置/视口状态
 */
export interface CanvasLayoutPosition {
  x: number
  y: number
}

export interface CanvasLayoutViewport extends CanvasLayoutPosition {
  zoom: number
}

export interface CanvasLayoutNode {
  id: string
  type?: string
  position: CanvasLayoutPosition
  width?: number
  height?: number
  /** 前端 React Flow 节点数据 — 存储边界：backend 不解读此字段内容 */
  data?: Record<string, unknown>
}

export interface CanvasLayoutEdge {
  id: string
  source: string
  target: string
  type?: string
  /** 前端 React Flow 边数据 — 存储边界：backend 不解读此字段内容 */
  data?: Record<string, unknown>
}

export interface CanvasLayoutDto {
  nodes: CanvasLayoutNode[]
  edges: CanvasLayoutEdge[]
  viewport?: CanvasLayoutViewport
}

/** 用户可选择的模型类别偏好 */
export interface CanvasModelPreferences {
  textModel?: string
  imageModel?: string
  videoModel?: string
}

// ===== Workflow Domain Types =====

/**
 * Workflow 预研 payload。
 *
 * 当前 workflow 只提供 DB/repository 基础设施，尚未启用具体 runner。
 * JSONB 内容会随 workflow type 演进，因此先收敛到命名边界类型；
 * 真正启用某个 workflow type 时，应继续拆成可辨识联合或 Zod schema。
 */
export interface WorkflowPayload {
  [key: string]: unknown
}

export type WorkflowInput = WorkflowPayload
export type WorkflowOutput = WorkflowPayload
export type WorkflowStepInput = WorkflowPayload
export type WorkflowStepOutput = WorkflowPayload

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
 * 生成任务输入参数信封 — 存储在 generation_records.inputParams JSONB 中
 *
 * 平坦结构：模型参数（prompt, n, duration, resolution 等）与信封字段
 * （source, projectId, shotId, referenceFileIds）在同一层级。
 * DB JSONB 无法按模型区分参数结构，故用 index signature 兼容动态键。
 *
 * 业务代码应通过 ValidatedModelParameters（@excuse/provider）访问模型参数，
 * 不应直接索引此信封的 unknown 字段。
 */
export interface GenerationInputParams {
  /** Canvas 来源标记（仅当 source === 'canvas' 时存在） */
  source?: 'canvas'
  /** Canvas 项目 ID（仅 canvas 来源时存在） */
  projectId?: string
  /** Canvas 镜头 ID（仅 canvas 来源时存在） */
  shotId?: string
  /** 参考文件 ID 列表（用户上传参考图时存在） */
  referenceFileIds?: string[]
  /**
   * 模型参数 — 动态键，由 ModelConfig.parameters 声明决定。
   * DB JSONB 存储边界：无法静态枚举所有模型的参数组合。
   * 服务层应通过 ValidatedModelParameters 访问，此处仅存储。
   */
  [key: string]: unknown
}

/**
 * 费用明细（jsonb cost 字段的域类型）
 *  quantity / unitPrice 仅 image/video variant 存在；
 *  token variant 使用 inputUnitPrice / outputUnitPrice / inputCost / outputCost
 */
export interface CostDetail {
  unit: 'token' | 'image' | 'video'
  totalPriceCents: number // 整数分，金额的权威值
  totalPrice: number // 元（浮点），向后兼容
  quantity?: number
  unitPriceCents?: number // 分（整数）
  unitPrice?: number // 元（浮点），向后兼容
  inputTokens?: number
  outputTokens?: number
  inputUnitPriceCents?: number // 分
  inputUnitPrice?: number // 元，向后兼容
  outputUnitPriceCents?: number // 分
  outputUnitPrice?: number // 元，向后兼容
  inputCostCents?: number // 分
  inputCost?: number // 元，向后兼容
  outputCostCents?: number // 分
  outputCost?: number // 元，向后兼容
  resolution?: string
  duration?: number
  estimated?: boolean
  /** 是否计入账单 — 失败/取消的任务 billable=false */
  billable?: boolean
  /** 费用来源: 'actual' = provider 返回实际用量, 'estimated' = 前端预估值 */
  source?: 'actual' | 'estimated'
  /** 失败策略: 'charge' = 仍收费, 'waive' = 免除, 'partial' = 部分收费 */
  failurePolicy?: 'charge' | 'waive' | 'partial'
}

/** 文本输出 */
export interface TextOutputResult {
  type: 'text'
  text: string
}

/** 图片输出 */
export interface ImageOutputResult {
  type: 'image'
  savedUrls: string[]
  urls?: string[]
}

/** 视频输出 */
export interface VideoOutputResult {
  type: 'video'
  savedUrls: string[]
  originalUrl?: string
  /** @deprecated 使用 originalUrl。保留以兼容 DashScope 旧数据 */
  video_url?: string
}

/** 处理中状态（异步任务尚未完成） */
export interface ProcessingOutputResult {
  type: 'processing'
  taskId?: string
  status?: string
}

/** outputResult 的所有可能形态（可辨识联合，通过 type 字段区分） */
export type OutputResult
  = | TextOutputResult
    | ImageOutputResult
    | VideoOutputResult
    | ProcessingOutputResult

/**
 * Worker → PostgreSQL NOTIFY 的负载
 *
 * Worker 在更新 DB 后通过 pgClient.notify() 发送，
 * Server 端通过 LISTEN 接收并映射为 SSE 事件推送到前端。
 *
 * status / category 使用字符串字面量而非 pgEnum 推断类型，
 * 因为 domain-types.ts 不依赖 schema 层。
 */
export interface GenerationNotifyPayload {
  accountId: string
  recordId: string
  status: 'pending' | 'submitting' | 'processing' | 'saving_output' | 'succeeded' | 'failed' | 'cancelled'
  category: 'text' | 'image' | 'video'
  model: string
  /** 异步任务 ID（可为 null：未提交到 provider 的任务如用户取消 pending 状态） */
  taskId: string | null
  traceId?: string | null
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
  /** Canvas pipeline 元数据（仅当 source === 'canvas' 时存在） */
  canvasMeta?: {
    projectId: string
    shotId: string
  }
}
