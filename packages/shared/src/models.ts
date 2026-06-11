// ===== 模型相关类型定义 =====

export interface ModelParameter {
  name: string
  type: 'text' | 'number' | 'select' | 'boolean'
  description?: string
  required?: boolean
  defaultValue?: unknown
  options?: { label: string, value: unknown }[]
  min?: number
  max?: number
  /** 存在则渲染为上传控件而非文本框。accept 为 MIME 类型（如 'image/*'） */
  mediaUpload?: { accept: string, multiple?: boolean }
}

export interface ModelPricing {
  inputPrice: number // 文本：每百万 Token 价格（元）；图片：每张价格（元）；视频：720P 每秒价格（元）
  outputPrice?: number // 文本输出：每百万 Token 价格（元）
  inputPrice1080?: number // 视频：1080P 每秒价格（元）
  unit?: 'token' | 'image' | 'video'
  note?: string
}

/**
 * 参数到请求体的映射规则
 * 让客户端无需 model-name 分支即可构建正确的 API 请求
 */
export type InputMapping
  = | { target: 'prompt' } // → input.prompt（或 chat/image 模型的 messages content）
    | { target: 'media', mediaType: string } // → input.media[].{type, url}
    | { target: 'mediaField', field: string } // → input.<field>（如 audio_url、media_type）
    | { target: 'parameter' } // → parameters.<paramName>
    | { target: 'ignored' } // 仅 UI 展示，不发 API

/**
 * 请求体形状
 * - chat: 文本模型 — input.messages[]
 * - image: 图像生成 — input.messages[].content[].text
 * - video-t2v: 文生视频 — input.prompt（纯文本）
 * - video-media: 图生/参考生/编辑视频 — input.media[]
 */
export type RequestType = 'chat' | 'image' | 'video-t2v' | 'video-media'

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
  /** 请求体形状，决定客户端如何组装 request body */
  requestType?: RequestType
  /** 每个参数到请求体的映射。Key = 参数名，Value = 映射规则 */
  inputMapping?: Record<string, InputMapping>
  /** referenceUrls 数组映射到 input.media[] 时使用的 type（仅 r2v 等模型需要） */
  referenceMediaType?: string
  /** 失败时的降级模型 ID（如 r2v → t2v） */
  fallbackModel?: string
}

export const MODEL_CATEGORIES = [
  { id: 'text' as const, name: '文本生成', color: 'blue' },
  { id: 'image' as const, name: '图像生成', color: 'purple' },
  { id: 'video' as const, name: '视频生成', color: 'pink' },
] as const

export type ModelCategory = typeof MODEL_CATEGORIES[number]['id']
