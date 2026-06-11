// ===== 生成记录相关类型 =====
// CostDetail / OutputResult 从 @excuse/db domain-types 导入（import type，零运行时影响）
// DB schema 现已使用精确 $type，InferSelectModel 自动推断为域类型

import type {
  CostDetail,
  GenerationCategory,
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
export type { CostDetail, GenerationCategory, GenerationStatus }
export type { ImageOutputResult, OutputResult, ProcessingOutputResult, TextOutputResult, VideoOutputResult }

// ===== SSE → GenerationRecord 运行时解析 =====

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
