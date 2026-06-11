import type { InputMapping, ModelConfig } from '@excuse/shared'
import type { DashScopeConfig, ProviderResult, TaskStatus } from './types'
import type {
  DashScopeChatResponse,
  DashScopeImageResponse,
  DashScopeOpenaiChatResponse,
  DashScopeTaskQueryResponse,
  DashScopeUsage,
  DashScopeVideoSubmitResponse,
} from './dashscope-types'
import { parseDashScopeError } from './dashscope-errors'
import { getModelById } from './model-configs'

export class DashScopeClient {
  private config: DashScopeConfig

  constructor(config: DashScopeConfig) {
    this.config = config
  }

  private get baseUrl(): string {
    return this.config.baseUrl || 'https://dashscope.aliyuncs.com/api/v1'
  }

  private get headers(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.config.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  // ── 声明式请求体构建 ──────────────────────────────────
  //
  // 根据 model-configs 中的 requestType + inputMapping 自动组装请求体，
  // 无需任何 model-name 分支判断。新增模型只需编辑 model-configs.ts。

  /**
   * 根据 inputMapping 遍历 params，把每个参数放入正确的请求体位置。
   * 返回 { input, parameters, media } 三个中间收集器。
   */
  private applyMappings(
    params: Record<string, unknown>,
    inputMapping: Record<string, InputMapping>,
  ): {
    input: Record<string, unknown>
    parameters: Record<string, unknown>
    media: Array<{ type: string, url: string }>
  } {
    const input: Record<string, unknown> = {}
    const parameters: Record<string, unknown> = {}
    const media: Array<{ type: string, url: string }> = []

    for (const [paramName, mapping] of Object.entries(inputMapping)) {
      const value = params[paramName]
      // 跳过未提供、null 的参数
      if (value === undefined || value === null)
        continue
      // 跳过空字符串
      if (typeof value === 'string' && value.trim() === '')
        continue
      // 保留 false / 0 等有意义的 falsy 值

      switch (mapping.target) {
        case 'prompt':
          input.prompt = value
          break
        case 'parameter':
          parameters[paramName] = value
          break
        case 'mediaField':
          input[mapping.field] = value
          break
        case 'media':
          media.push({ type: mapping.mediaType, url: value as string })
          break
        case 'ignored':
          break
      }
    }

    return { input, parameters, media }
  }

  /**
   * 根据 requestType 组装最终请求体
   */
  private buildRequestBody(
    modelConfig: ModelConfig,
    params: Record<string, unknown>,
    referenceUrls?: string[],
  ): Record<string, unknown> {
    const { requestType, inputMapping } = modelConfig
    if (!inputMapping || !requestType) {
      throw new Error(`模型 ${modelConfig.id} 缺少 requestType 或 inputMapping 配置`)
    }

    const { input, parameters, media } = this.applyMappings(params, inputMapping)

    // referenceUrls → input.media[]（仅 r2v 等声明了 referenceMediaType 的模型）
    if (referenceUrls?.length && modelConfig.referenceMediaType) {
      for (const url of referenceUrls) {
        media.push({ type: modelConfig.referenceMediaType, url })
      }
    }

    switch (requestType) {
      case 'chat': {
        // 文本模型：input.messages[{ role: "user", content: prompt }]
        return {
          model: modelConfig.id,
          input: {
            messages: [{ role: 'user', content: input.prompt || '' }],
          },
          parameters: {
            ...parameters,
            result_format: 'message',
          },
        }
      }

      case 'image': {
        // 图像模型：input.messages[{ role: "user", content: [{ text: prompt }] }]
        return {
          model: modelConfig.id,
          input: {
            messages: [{
              role: 'user',
              content: [{ text: input.prompt || '' }],
            }],
          },
          parameters,
        }
      }

      case 'video-t2v': {
        // 文生视频：input.prompt + input.audio_url/negative_prompt + parameters
        if (media.length > 0) {
          input.media = media
        }
        return {
          model: modelConfig.id,
          input,
          parameters,
        }
      }

      case 'openai-chat': {
        // OpenAI 兼容格式：messages + parameters 在顶层
        return {
          model: modelConfig.id,
          messages: [{ role: 'user', content: input.prompt || '' }],
          ...parameters,
        }
      }

      case 'video-media': {
        // 图生/参考生/编辑视频：input.prompt + input.media[] + input.negative_prompt + parameters
        if (media.length > 0) {
          input.media = media
        }
        return {
          model: modelConfig.id,
          input,
          parameters,
        }
      }

      default:
        throw new Error(`未知的 requestType: ${requestType}`)
    }
  }

  // ── 公开 API 方法 ──────────────────────────────────────

  /**
   * 文本生成 — 调用千问系列模型
   */
  async chatCompletion(model: string, params: Record<string, unknown>): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `未知模型: ${model}` }
    }

    const body = this.buildRequestBody(modelConfig, params)

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeChatResponse | DashScopeOpenaiChatResponse

      if (response.status !== 200) {
        return { success: false, error: `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data as unknown as Record<string, unknown>)}` }
      }

      const isOpenaiFormat = modelConfig.requestType === 'openai-chat'
      const usage: DashScopeUsage = isOpenaiFormat
        ? (data as DashScopeOpenaiChatResponse).usage ?? {}
        : (data as DashScopeChatResponse).usage ?? {}

      let text: string
      if (isOpenaiFormat) {
        text = (data as DashScopeOpenaiChatResponse).choices?.[0]?.message?.content ?? ''
      } else {
        const output = (data as DashScopeChatResponse).output
        const content = output.choices?.[0]?.message?.content
        text = Array.isArray(content)
          ? content[0]?.text ?? ''
          : typeof content === 'string' ? content : ''
        if (!text && output.text) text = output.text
      }

      return {
        success: true,
        output: {
          text,
          raw: data,
        },
        usage: {
          inputTokens: usage.input_tokens ?? usage.prompt_tokens ?? 0,
          outputTokens: usage.output_tokens ?? usage.completion_tokens ?? 0,
        },
      }
    }
    catch (error) {
      return { success: false, error: `网络错误：无法连接百炼 API（${(error as Error).message}）` }
    }
  }

  /**
   * 图片生成 — 调用千问图像系列模型（同步）
   */
  async generateImage(model: string, params: Record<string, unknown>): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `未知模型: ${model}` }
    }

    const body = this.buildRequestBody(modelConfig, params)

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeImageResponse

      if (response.status !== 200) {
        return { success: false, error: `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data as unknown as Record<string, unknown>)}` }
      }

      const output = data.output ?? {}
      const usage: DashScopeUsage = data.usage ?? {}

      // 百炼同步图像 API 返回格式：output.choices[].message.content[].image
      const choices = output.choices ?? []
      const urls = choices.flatMap(c =>
        (c.message?.content ?? []).map(item => item.image).filter(Boolean),
      )

      return {
        success: true,
        output: {
          urls,
          raw: data,
        },
        usage: {
          imageCount: usage.image_count || urls.length,
        },
      }
    }
    catch (error) {
      return { success: false, error: `网络错误：无法连接百炼 API（${(error as Error).message}）` }
    }
  }

  /**
   * 视频生成 — 异步提交任务
   * 返回 DashScope task_id，需要后续轮询
   */
  async submitVideoTask(model: string, params: Record<string, unknown>, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `未知模型: ${model}` }
    }

    const body = this.buildRequestBody(modelConfig, params, referenceUrls)
    const duration = typeof params.duration === 'number' ? params.duration : 0

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json() as DashScopeVideoSubmitResponse

      if (response.status !== 200) {
        return { success: false, error: `模型 ${modelConfig.name}（${modelConfig.id}）: ${parseDashScopeError(data as unknown as Record<string, unknown>)}` }
      }

      const taskId = data.output?.task_id ?? data.request_id

      return {
        success: true,
        providerTaskId: taskId,
        output: {
          taskId,
          status: 'submitted',
          raw: data,
        },
        usage: {
          videoDuration: duration,
        },
      }
    }
    catch (error) {
      return { success: false, error: `网络错误：无法连接百炼 API（${(error as Error).message}）` }
    }
  }

  /**
   * 视频生成 — 异步提交任务 + 自动 fallback
   * 先尝试主模型，失败时自动尝试 modelConfig.fallbackModel
   * 返回最终使用的 model、taskId 和成功状态
   */
  async submitVideoTaskWithFallback(
    model: string,
    params: Record<string, unknown>,
    referenceUrls?: string[],
  ): Promise<{ model: string, taskId: string | undefined, success: boolean, error?: string }> {
    const result = await this.submitVideoTask(model, params, referenceUrls)

    if (result.success && result.providerTaskId) {
      return { model, taskId: result.providerTaskId, success: true }
    }

    const modelConfig = getModelById(model)
    const fallbackId = modelConfig?.fallbackModel
    if (fallbackId) {
      const fallbackResult = await this.submitVideoTask(fallbackId, params)
      if (fallbackResult.success && fallbackResult.providerTaskId) {
        return { model: fallbackId, taskId: fallbackResult.providerTaskId, success: true }
      }
    }

    return { model, taskId: undefined, success: false, error: result.error || '视频提交失败' }
  }

  /**
   * 查询异步任务状态
   */
  async queryTask(taskId: string): Promise<TaskStatus> {
    const url = `${this.baseUrl}/tasks/${taskId}`

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
      })

      const data = await response.json() as DashScopeTaskQueryResponse
      const output = data.output ?? {}
      const taskStatus = output.task_status ?? 'UNKNOWN'

      // 任务失败时用友好的中文消息
      const errorCode = output.code ?? data.code
      const errorMessage = taskStatus === 'FAILED'
        ? parseDashScopeError(data as unknown as Record<string, unknown>)
        : output.message ?? data.message

      return {
        taskId,
        status: taskStatus as TaskStatus['status'],
        // 万相 / HappyHorse 视频任务成功时返回 video_url（无 results）
        // 图片异步任务成功时返回 results 数组
        output: output.video_url || output.results
          ? { results: output.results, video_url: output.video_url }
          : undefined,
        usage: data.usage,
        errorCode,
        errorMessage,
      }
    }
    catch (error) {
      return {
        taskId,
        status: 'UNKNOWN',
        errorMessage: `网络错误：无法查询任务状态（${(error as Error).message}）`,
      }
    }
  }

  async cancelTask(taskId: string): Promise<boolean> {
    const url = `${this.baseUrl}/tasks/${taskId}`
    try {
      const response = await fetch(url, {
        method: 'DELETE',
        headers: this.headers,
      })
      return response.ok
    }
    catch {
      return false
    }
  }

  /**
   * 生成内容 — 根据模型类别自动路由到正确的 API
   */
  async generate(model: string, params: Record<string, unknown>, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `未知模型: ${model}` }
    }

    switch (modelConfig.category) {
      case 'text':
        return this.chatCompletion(model, params)
      case 'image':
        return this.generateImage(model, params)
      case 'video':
        return this.submitVideoTask(model, params, referenceUrls)
      default:
        return { success: false, error: `不支持的模型类别: ${modelConfig.category}` }
    }
  }
}
