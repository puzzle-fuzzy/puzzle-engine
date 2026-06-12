// ===== 生成记录相关类型 =====
// CostDetail / OutputResult 从 @excuse/db domain-types 导入（import type，零运行时影响）
// DB schema 现已使用精确 $type，InferSelectModel 自动推断为域类型

import type {
  CostDetail,
  GenerationCategory,
  GenerationInputParams,
  GenerationNotifyPayload,
  GenerationRecordRow,
  GenerationStatus,
  ImageOutputResult,
  OutputResult,
  ProcessingOutputResult,
  Serialize,
  TextOutputResult,
  VideoOutputResult,
} from '@excuse/db'

// 重导出域类型，保持下游 import 不变
export type { CostDetail, GenerationCategory, GenerationInputParams, GenerationNotifyPayload, GenerationStatus }
export type { ImageOutputResult, OutputResult, ProcessingOutputResult, TextOutputResult, VideoOutputResult }

// ===== SSE → GenerationRecord 运行时解析 =====

/** 根据 type 辨识字段的类型守卫 */
export function isTextOutput(o: OutputResult | null | undefined): o is TextOutputResult {
  return o != null && o.type === 'text'
}
export function isImageOutput(o: OutputResult | null | undefined): o is ImageOutputResult {
  return o != null && o.type === 'image'
}
export function isVideoOutput(o: OutputResult | null | undefined): o is VideoOutputResult {
  return o != null && o.type === 'video'
}
export function isProcessingOutput(o: OutputResult | null | undefined): o is ProcessingOutputResult {
  return o != null && o.type === 'processing'
}

// ===== SSE → GenerationRecord 运行时解析 =====

/** 将 SSE 端的 Record<string, unknown> 解析为 OutputResult discriminated union */
export function parseOutputResult(data: unknown): OutputResult | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>

  // 已有 type 辨识字段（新版）
  if ('type' in o && typeof o.type === 'string') {
    switch (o.type) {
      case 'text':
        return { type: 'text', text: typeof o.text === 'string' ? o.text : '' }
      case 'image':
        return { type: 'image', savedUrls: Array.isArray(o.savedUrls) ? o.savedUrls as string[] : [], urls: Array.isArray(o.urls) ? o.urls as string[] : undefined }
      case 'video':
        return { type: 'video', savedUrls: Array.isArray(o.savedUrls) ? o.savedUrls as string[] : [], originalUrl: typeof o.originalUrl === 'string' ? o.originalUrl : undefined, video_url: typeof o.video_url === 'string' ? o.video_url : undefined }
      case 'processing':
        return { type: 'processing', taskId: typeof o.taskId === 'string' ? o.taskId : undefined, status: typeof o.status === 'string' ? o.status : undefined }
      default:
        break
    }
  }

  // 兼容旧数据（无 type 字段）
  if ('text' in o && typeof o.text === 'string')
    return { type: 'text', text: o.text } satisfies TextOutputResult
  if ('savedUrls' in o && Array.isArray(o.savedUrls)) {
    if ('originalUrl' in o || 'video_url' in o)
      return { type: 'video', savedUrls: o.savedUrls as string[], originalUrl: typeof o.originalUrl === 'string' ? o.originalUrl : undefined, video_url: typeof o.video_url === 'string' ? o.video_url : undefined } satisfies VideoOutputResult
    return { type: 'image', savedUrls: o.savedUrls as string[], urls: Array.isArray(o.urls) ? o.urls as string[] : undefined } satisfies ImageOutputResult
  }
  if ('taskId' in o || 'status' in o)
    return { type: 'processing', taskId: typeof o.taskId === 'string' ? o.taskId : undefined, status: typeof o.status === 'string' ? o.status : undefined } satisfies ProcessingOutputResult
  return null
}

/** 将 SSE 端的 Record<string, unknown> 解析为 CostDetail */
export function parseCostDetail(data: unknown): CostDetail | null {
  if (data == null || typeof data !== 'object')
    return null
  const o = data as Record<string, unknown>
  if ('unit' in o && ('totalPrice' in o || 'totalPriceCents' in o)) {
    const totalPriceCents = typeof o.totalPriceCents === 'number' ? o.totalPriceCents : 0
    const totalPrice = typeof o.totalPrice === 'number' ? o.totalPrice : totalPriceCents / 100
    return {
      unit: (['token', 'image', 'video'].includes(o.unit as string) ? o.unit : 'token') as CostDetail['unit'],
      totalPriceCents,
      totalPrice,
      quantity: typeof o.quantity === 'number' ? o.quantity : undefined,
      unitPriceCents: typeof o.unitPriceCents === 'number' ? o.unitPriceCents : undefined,
      unitPrice: typeof o.unitPrice === 'number' ? o.unitPrice : undefined,
      inputTokens: typeof o.inputTokens === 'number' ? o.inputTokens : undefined,
      outputTokens: typeof o.outputTokens === 'number' ? o.outputTokens : undefined,
      inputUnitPriceCents: typeof o.inputUnitPriceCents === 'number' ? o.inputUnitPriceCents : undefined,
      inputUnitPrice: typeof o.inputUnitPrice === 'number' ? o.inputUnitPrice : undefined,
      outputUnitPriceCents: typeof o.outputUnitPriceCents === 'number' ? o.outputUnitPriceCents : undefined,
      outputUnitPrice: typeof o.outputUnitPrice === 'number' ? o.outputUnitPrice : undefined,
      inputCostCents: typeof o.inputCostCents === 'number' ? o.inputCostCents : undefined,
      inputCost: typeof o.inputCost === 'number' ? o.inputCost : undefined,
      outputCostCents: typeof o.outputCostCents === 'number' ? o.outputCostCents : undefined,
      outputCost: typeof o.outputCost === 'number' ? o.outputCost : undefined,
      resolution: typeof o.resolution === 'string' ? o.resolution : undefined,
      duration: typeof o.duration === 'number' ? o.duration : undefined,
      estimated: typeof o.estimated === 'boolean' ? o.estimated : undefined,
    }
  }
  return null
}

// ===== 生成记录（从 Drizzle schema 推导，Date → string） =====

/**
 * API 层生成记录类型
 * schema 现已用 $type<CostDetail>() / $type<OutputResult>()
 * InferSelectModel 直接推断为域类型，无需 Omit 覆写
 */
export type GenerationRecord = Serialize<GenerationRecordRow>

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
