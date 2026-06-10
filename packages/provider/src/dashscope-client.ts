import type { DashScopeConfig, ProviderResult, TaskStatus } from './types'
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

  /**
   * 文本生成 — 调用千问系列模型
   * 使用 DashScope 原生 text-generation 端点
   */
  async chatCompletion(model: string, params: Record<string, unknown>): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `Unknown model: ${model}` }
    }

    const prompt = params.prompt as string || ''
    const maxTokens = params.max_tokens as number || 1500
    const temperature = params.temperature as number || 0.7
    const topP = params.top_p as number || 0.9

    const body = {
      model,
      input: {
        messages: [
          { role: 'user', content: prompt },
        ],
      },
      parameters: {
        max_tokens: maxTokens,
        temperature,
        top_p: topP,
        result_format: 'message',
      },
    }

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as Record<string, unknown>

      if (response.status !== 200) {
        const errorMsg = (data as any).message || JSON.stringify(data)
        return { success: false, error: `DashScope error: ${errorMsg}` }
      }

      const output = (data as any).output || {}
      const usage = (data as any).usage || {}

      return {
        success: true,
        output: {
          text: output.choices?.[0]?.message?.content?.[0]?.text
            || output.text
            || output.choices?.[0]?.message?.content
            || '',
          raw: data,
        },
        usage: {
          inputTokens: usage.input_tokens || 0,
          outputTokens: usage.output_tokens || 0,
        },
      }
    }
    catch (error) {
      return { success: false, error: `Network error: ${(error as Error).message}` }
    }
  }

  /**
   * 图片生成 — 调用千问图像系列模型
   * 使用 multimodal-generation 端点（同步）
   */
  async generateImage(model: string, params: Record<string, unknown>): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `Unknown model: ${model}` }
    }

    const prompt = params.prompt as string || ''
    const size = params.size as string || '2048*2048'
    const n = params.n as number || 1
    const negativePrompt = params.negative_prompt as string || undefined
    const watermark = params.watermark as boolean ?? false
    const promptExtend = params.prompt_extend as boolean ?? true

    const body: Record<string, unknown> = {
      model,
      input: {
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: prompt }],
          },
        ],
      },
      parameters: {
        size,
        n,
        watermark,
        prompt_extend: promptExtend,
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
    }

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify(body),
      })

      const data = await response.json() as Record<string, unknown>

      if (response.status !== 200) {
        const errorMsg = (data as any).message || JSON.stringify(data)
        return { success: false, error: `DashScope error: ${errorMsg}` }
      }

      const output = (data as any).output || {}
      const results = output.results || []
      const urls = results.map((r: any) => r.url || r.b64_image).filter(Boolean)

      return {
        success: true,
        output: {
          urls,
          raw: data,
        },
        usage: {
          imageCount: urls.length || n,
        },
      }
    }
    catch (error) {
      return { success: false, error: `Network error: ${(error as Error).message}` }
    }
  }

  /**
   * 视频生成 — 异步提交
   * 返回 DashScope task_id，需要后续轮询
   */
  async submitVideoTask(model: string, params: Record<string, unknown>, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `Unknown model: ${model}` }
    }

    const prompt = params.prompt as string || ''
    const resolution = params.resolution as string || '720P'
    const duration = params.duration as number || 5
    const ratio = params.ratio as string || '16:9'
    const watermark = params.watermark as boolean ?? true
    const promptExtend = params.prompt_extend as boolean ?? true
    const negativePrompt = params.negative_prompt as string || undefined

    const body: Record<string, unknown> = {
      model,
      input: {},
      parameters: {
        resolution,
        duration,
        ...(ratio ? { ratio } : {}),
        watermark,
        ...(promptExtend ? { prompt_extend: promptExtend } : {}),
        ...(negativePrompt ? { negative_prompt: negativePrompt } : {}),
      },
    }

    // 构建 input 内容
    const inputContent: Record<string, unknown> = {}

    // 根据模型类型设置不同的 input
    if (model.includes('t2v') || model.includes('videoedit')) {
      // 文生视频 / 视频编辑
      inputContent.prompt = prompt
    }

    if (model.includes('i2v')) {
      // 图生视频 — 首帧
      const firstFrameUrl = params.first_frame_url as string
      if (firstFrameUrl) {
        inputContent.img_url = firstFrameUrl
      }
      if (prompt) {
        inputContent.prompt = prompt
      }
    }

    if (model.includes('r2v')) {
      // 参考生视频 — 多参考图
      if (referenceUrls && referenceUrls.length > 0) {
        inputContent.ref_img_urls = referenceUrls
      }
      inputContent.prompt = prompt
    }

    if (model.includes('videoedit')) {
      // 视频编辑
      const videoUrl = params.video_url as string
      if (videoUrl) {
        inputContent.video_url = videoUrl
      }
    }

    // wan2.7-i2v 特殊处理：media_type
    if (model === 'wan2.7-i2v') {
      const mediaType = params.media_type as string || 'first_frame'
      inputContent.media_type = mediaType

      const firstFrameUrl = params.first_frame_url as string
      const lastFrameUrl = params.last_frame_url as string
      const videoUrl = params.video_url as string
      const audioUrl = params.audio_url as string

      if (firstFrameUrl)
        inputContent.img_url = firstFrameUrl
      if (lastFrameUrl)
        inputContent.tail_img_url = lastFrameUrl
      if (videoUrl)
        inputContent.video_url = videoUrl
      if (audioUrl)
        inputContent.audio_url = audioUrl
      if (prompt)
        inputContent.prompt = prompt
    }

    body.input = inputContent

    try {
      const response = await fetch(modelConfig.endpoint, {
        method: 'POST',
        headers: {
          ...this.headers,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json() as Record<string, unknown>

      if (response.status !== 200) {
        const errorMsg = (data as any).message || JSON.stringify(data)
        return { success: false, error: `DashScope error: ${errorMsg}` }
      }

      const taskId = (data as any).output?.task_id || (data as any).request_id

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
      return { success: false, error: `Network error: ${(error as Error).message}` }
    }
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

      const data = await response.json() as Record<string, unknown>
      const output = (data as any).output || {}
      const taskStatus = output.task_status || 'UNKNOWN'

      return {
        taskId,
        status: taskStatus as TaskStatus['status'],
        output: output.results ? { results: output.results, video_url: output.video_url } : undefined,
        usage: (data as any).usage,
        errorCode: output.code || (data as any).code,
        errorMessage: output.message || (data as any).message,
      }
    }
    catch (error) {
      return {
        taskId,
        status: 'UNKNOWN',
        errorMessage: `Network error: ${(error as Error).message}`,
      }
    }
  }

  /**
   * 生成内容 — 根据模型类别自动路由到正确的 API
   */
  async generate(model: string, params: Record<string, unknown>, referenceUrls?: string[]): Promise<ProviderResult> {
    const modelConfig = getModelById(model)
    if (!modelConfig) {
      return { success: false, error: `Unknown model: ${model}` }
    }

    switch (modelConfig.category) {
      case 'text':
        return this.chatCompletion(model, params)
      case 'image':
        return this.generateImage(model, params)
      case 'video':
        return this.submitVideoTask(model, params, referenceUrls)
      default:
        return { success: false, error: `Unsupported category: ${modelConfig.category}` }
    }
  }
}
