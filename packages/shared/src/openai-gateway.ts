// ── OpenAI 兼容网关 DTO ──────────────────────────────────

/** OpenAI Chat Completions 请求体 */
export interface OpenAIChatRequest {
  model: string
  messages: Array<OpenAIChatMessage>
  temperature?: number
  max_tokens?: number
  top_p?: number
  stream?: boolean
}

export interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** OpenAI Chat Completions 响应体 */
export interface OpenAIChatResponse {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: Array<{
    index: number
    message: { role: 'assistant', content: string }
    finish_reason: 'stop' | 'length'
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/** OpenAI Models 响应体 */
export interface OpenAIModelsResponse {
  object: 'list'
  data: Array<{
    id: string
    object: 'model'
    created: number
    owned_by: string
  }>
}

/** OpenAI 错误响应 */
export interface OpenAIErrorResponse {
  error: {
    message: string
    type: string
    code: string
  }
}

/** 模型别名映射（OpenAI 风格名 → 内部 model ID） */
export const MODEL_ALIASES: Record<string, string> = {
  'gpt-4': 'qwen-max',
  'gpt-4o': 'qwen-max',
  'gpt-3.5-turbo': 'qwen-turbo',
  'gpt-4o-mini': 'qwen-plus',
}

/** 将用户传入的模型名解析为内部 ID */
export function resolveModelId(model: string): string {
  return MODEL_ALIASES[model] ?? model
}
