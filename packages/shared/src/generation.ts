// ===== 生成记录相关类型 =====
// 核心原则：类型从 Drizzle schema 推导，不手动重复定义

import type {
  GenerationCategory,
  GenerationRecordRow,
  GenerationStatus,
  Serialize,
} from '@excuse/db'

// ===== 枚举类型 — 从 @excuse/db 的 pgEnum 定义推断 =====
export type { GenerationCategory, GenerationStatus }

// ===== 费用明细（jsonb cost 字段的应用层类型） =====

export interface CostDetail {
  unit: 'token' | 'image' | 'video'
  quantity: number
  unitPrice: number
  totalPrice: number
  inputTokens?: number
  outputTokens?: number
  resolution?: string
  duration?: number
  /** 预估费用标记 */
  estimated?: boolean
}

// ===== 输出结果（outputResult jsonb 字段的 discriminated union） =====

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
export type OutputResult =
  | TextOutputResult
  | ImageOutputResult
  | VideoOutputResult
  | ProcessingOutputResult

/** 根据 category 获取对应输出类型的类型守卫辅助 */
export function isTextOutput(o: OutputResult | null): o is TextOutputResult {
  return o != null && 'text' in o
}
export function isImageOutput(o: OutputResult | null): o is ImageOutputResult {
  return o != null && 'savedUrls' in o && !('originalUrl' in o || 'video_url' in o)
}
export function isVideoOutput(o: OutputResult | null): o is VideoOutputResult {
  return o != null && 'savedUrls' in o && ('originalUrl' in o || 'video_url' in o)
}
export function isProcessingOutput(o: OutputResult | null): o is ProcessingOutputResult {
  return o != null && 'taskId' in o && !('savedUrls' in o)
}

// ===== SSE → GenerationRecord 运行时解析 =====

/** 将 SSE 端的 Record<string, unknown> 解析为 OutputResult discriminated union */
export function parseOutputResult(data: unknown): OutputResult | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>
  if ('text' in o && typeof o.text === 'string')
    return { text: o.text }
  if ('savedUrls' in o && Array.isArray(o.savedUrls)) {
    if ('originalUrl' in o || 'video_url' in o)
      return { savedUrls: o.savedUrls as string[], originalUrl: typeof o.originalUrl === 'string' ? o.originalUrl : undefined }
    return { savedUrls: o.savedUrls as string[], urls: Array.isArray(o.urls) ? o.urls as string[] : undefined }
  }
  if ('taskId' in o || 'status' in o)
    return { taskId: typeof o.taskId === 'string' ? o.taskId : undefined, status: typeof o.status === 'string' ? o.status : undefined }
  return null
}

/** 将 SSE 端的 Record<string, unknown> 解析为 CostDetail */
export function parseCostDetail(data: unknown): CostDetail | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>
  if ('unit' in o && 'quantity' in o && 'unitPrice' in o && 'totalPrice' in o) {
    return {
      unit: o.unit as CostDetail['unit'],
      quantity: typeof o.quantity === 'number' ? o.quantity : 0,
      unitPrice: typeof o.unitPrice === 'number' ? o.unitPrice : 0,
      totalPrice: typeof o.totalPrice === 'number' ? o.totalPrice : 0,
      inputTokens: typeof o.inputTokens === 'number' ? o.inputTokens : undefined,
      outputTokens: typeof o.outputTokens === 'number' ? o.outputTokens : undefined,
      resolution: typeof o.resolution === 'string' ? o.resolution : undefined,
      duration: typeof o.duration === 'number' ? o.duration : undefined,
      estimated: typeof o.estimated === 'boolean' ? o.estimated : undefined,
    }
  }
  return null
}

// ===== 生成记录（从 Drizzle schema 推导，Date → string，cost/outputResult 用具体类型） =====

/**
 * API 层生成记录类型
 *
 * 推导链：Drizzle schema → InferSelectModel → Serialize (Date→string)
 * → 覆写 cost 和 outputResult 类型
 *
 * 这样做的好处：
 * - schema 变更时，类型自动同步（增删字段、改枚举值等）
 * - Date→string 只需在一处处理（Serialize 工具类型）
 * - cost/outputResult 字段用具体类型提供更强的类型约束
 */
export type GenerationRecord = Omit<Serialize<GenerationRecordRow>, 'cost' | 'outputResult'> & {
  cost: CostDetail | null
  outputResult: OutputResult | null
}

// ===== 请求/响应类型 =====

export interface GenerateRequest {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}

export interface GenerateResponse {
  success: boolean
  /** 生成成功时包含完整记录，失败时仅包含 id/错误信息 */
  record?: GenerationRecord
  /** 失败时的错误信息 */
  error?: string
  errorMessage?: string
}
