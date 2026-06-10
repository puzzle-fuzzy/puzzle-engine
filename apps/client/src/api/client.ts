import { treaty } from '@elysia/eden'
import type { App } from '../../../server/src/index'
import type { ModelConfig } from '@excuse/shared'
import type {
  GenerationRecord,
  GenerateResponse,
  BillingStatistics,
} from '@excuse/shared'

/**
 * Eden Treaty 客户端 — 端到端类型安全
 *
 * 通过 Vite 代理 (/api → localhost:5007) 与后端通信
 * 类型从 Drizzle schema → @excuse/db → @excuse/shared 单向推导
 */
export const api = treaty<App>('')

// ===== 导出共享类型（页面直接使用） =====

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { GenerationRecord, GenerateResponse } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'

/**
 * 费用信息类型（API 返回的 jsonb cost 字段）
 * 序列化后与 CostDetail 结构一致
 */
export type CostDetail = GenerationRecord['cost']

// ===== API 函数 =====

/** 获取支持的模型列表 */
export async function fetchModels(): Promise<{ models: ModelConfig[] }> {
  const { data, error } = await api.api.models.get()
  if (error) throw error
  return data as unknown as { models: ModelConfig[] }
}

/** 发起生成 */
export async function generate(params: {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}): Promise<GenerateResponse> {
  const { data, error } = await api.api.generate.post(params)
  if (error) throw error
  return data as unknown as GenerateResponse
}

/** 获取生成记录列表 */
export async function fetchRecords(params?: {
  category?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<{ records: GenerationRecord[]; total: number }> {
  const { data, error } = await api.api.records.get({
    query: {
      category: params?.category ?? '',
      status: params?.status ?? '',
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    },
  })
  if (error) throw error
  return data as unknown as { records: GenerationRecord[]; total: number }
}

/** 获取单条记录 */
export async function fetchRecord(id: string): Promise<{ success: boolean; record: GenerationRecord }> {
  const { data, error } = await api.api.records({ id }).get()
  if (error) throw error
  return data as unknown as { success: boolean; record: GenerationRecord }
}

/** 上传文件 */
export async function uploadFile(file: File): Promise<{
  success: boolean
  file: { id: string; fileName: string; publicUrl: string; mimeType: string }
}> {
  const formData = new FormData()
  formData.append('file', file)
  const { data, error } = await api.api.upload.post(formData)
  if (error) throw error
  return data as unknown as {
    success: boolean
    file: { id: string; fileName: string; publicUrl: string; mimeType: string }
  }
}

/** 获取计费统计 */
export async function fetchBillingStatistics(): Promise<{
  success: boolean
  statistics: BillingStatistics
}> {
  const { data, error } = await api.api.billing.statistics.get()
  if (error) throw error
  return data as unknown as { success: boolean; statistics: BillingStatistics }
}
