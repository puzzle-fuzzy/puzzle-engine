// ===== 模型相关类型定义 =====

export interface ModelParameter {
  name: string
  type: 'text' | 'number' | 'select' | 'boolean'
  description?: string
  required?: boolean
  defaultValue?: unknown
  options?: { label: string; value: unknown }[]
  min?: number
  max?: number
}

export interface ModelPricing {
  inputPrice: number // 文本：每百万 Token 价格（元）；图片：每张价格（元）；视频：720P 每秒价格（元）
  outputPrice?: number // 文本输出：每百万 Token 价格（元）
  inputPrice1080?: number // 视频：1080P 每秒价格（元）
  unit?: 'token' | 'image' | 'video'
  note?: string
}

export interface ModelConfig {
  id: string
  name: string
  category: 'text' | 'image' | 'video' | 'audio'
  type: 'generation' | 'understanding' | 'editing'
  description: string
  endpoint: string
  async: boolean
  pricing: ModelPricing
  parameters: ModelParameter[]
}

export const MODEL_CATEGORIES = [
  { id: 'text' as const, name: '文本生成', color: 'blue' },
  { id: 'image' as const, name: '图像生成', color: 'purple' },
  { id: 'video' as const, name: '视频生成', color: 'pink' },
] as const

export type ModelCategory = typeof MODEL_CATEGORIES[number]['id']
