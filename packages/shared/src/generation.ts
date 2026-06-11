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
}

// ===== 生成记录（从 Drizzle schema 推导，Date → string，cost 用具体类型） =====

/**
 * API 层生成记录类型
 *
 * 推导链：Drizzle schema → InferSelectModel → Serialize (Date→string) → 覆写 cost 类型
 *
 * 这样做的好处：
 * - schema 变更时，类型自动同步（增删字段、改枚举值等）
 * - Date→string 只需在一处处理（Serialize 工具类型）
 * - cost 字段用 CostDetail 提供更强的类型约束
 */
export type GenerationRecord = Omit<Serialize<GenerationRecordRow>, 'cost'> & {
  cost: CostDetail | null
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
