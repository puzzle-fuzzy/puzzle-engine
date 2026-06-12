/**
 * 字幕句子类型 — ASR 转录后的最小编辑单元
 *
 * 定义在 provider 包内（独立于 @excuse/db），因为 provider 不直接依赖 db。
 * 与 @excuse/db 中的 SubtitleSentence 接口结构一致。
 */
import { parseDashScopeError } from './dashscope-errors'

export interface SubtitleSentence {
  id: string
  text: string
  beginTime: number
  endTime: number
  speakerId?: number
}

/**
 * ASR 客户端配置
 */
export interface ASRConfig {
  apiKey: string
  baseUrl?: string
}

/**
 * ASR 提交结果
 */
export interface ASRSubmitResult {
  success: boolean
  taskId: string
  error?: string
}

/**
 * ASR 任务状态
 */
export interface ASRTaskStatus {
  taskId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  /** 转录结果下载 URL（仅 SUCCEEDED 时有值，24 小时过期） */
  transcriptionUrl?: string
  /** 视频文件 URL（原始输入文件） */
  fileUrl?: string
  /** 音频时长（秒） */
  durationSeconds?: number
  errorMessage?: string
}

/**
 * ASR 转录选项
 */
export interface ASROptions {
  /** 语言提示，如 ['zh', 'en'] */
  languageHints?: string[]
  /** 是否启用语音去噪（去除语气词等） */
  disfluencyRemovalEnabled?: boolean
  /** 是否启用说话人分离 */
  diarizationEnabled?: boolean
  /** 说话人数量（diarizationEnabled 时有效） */
  speakerCount?: number
}

/**
 * DashScope Paraformer-v2 ASR 客户端
 *
 * 使用独立的 RESTful 端点，与 DashScopeClient（text/image/video）平行但不继承。
 * Paraformer 的请求/响应格式完全不同于其他模型，不适合塞进声明式配置系统。
 *
 * API 流程：异步提交 → 返回 task_id → Worker 轮询 → 下载转录 JSON
 * 端点：POST /api/v1/services/audio/asr/transcription（提交）
 *       POST /api/v1/tasks/{task_id}（查询）
 */
export class ASRClient {
  private config: ASRConfig

  constructor(config: ASRConfig) {
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
   * 提交异步转录任务（音频文件 URL）
   *
   * Paraformer-v2 离线文件转录 API 支持任意长度音频，
   * 异步返回 task_id，Worker 通过 queryTask() 轮询进度。
   */
  async submitTranscription(audioUrl: string, options?: ASROptions): Promise<ASRSubmitResult> {
    const body = {
      model: 'paraformer-v2',
      input: {
        file_urls: [audioUrl],
      },
      parameters: {
        channel_id: [0],
        disfluency_removal_enabled: options?.disfluencyRemovalEnabled ?? false,
        timestamp_alignment_enabled: true,
        language_hints: options?.languageHints ?? ['zh', 'en'],
        diarization_enabled: options?.diarizationEnabled ?? false,
        ...(options?.speakerCount && { speaker_count: options.speakerCount }),
      },
    }

    try {
      const response = await fetch(`${this.baseUrl}/services/audio/asr/transcription`, {
        method: 'POST',
        headers: {
          ...this.headers,
          'X-DashScope-Async': 'enable',
        },
        body: JSON.stringify(body),
      })

      const data = await response.json() as Record<string, unknown>

      if (response.status !== 200) {
        const errorMsg = parseDashScopeError(data)
        return { success: false, taskId: '', error: errorMsg }
      }

      const output = data.output as Record<string, unknown> | undefined
      const taskId = (output?.task_id as string) ?? (data.request_id as string)

      if (!taskId) {
        return { success: false, taskId: '', error: '未返回 task_id' }
      }

      return { success: true, taskId }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return { success: false, taskId: '', error: `网络错误：无法连接 ASR API（${msg}）` }
    }
  }

  /**
   * 查询异步转录任务状态
   *
   * 复用 DashScope 的通用任务查询端点 /api/v1/tasks/{task_id}
   * 返回格式与视频任务查询相同（task_status + results）
   */
  async queryTask(taskId: string): Promise<ASRTaskStatus> {
    const url = `${this.baseUrl}/tasks/${taskId}`

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers,
      })

      const data = await response.json() as Record<string, unknown>
      const output = (data.output ?? {}) as Record<string, unknown>
      const rawStatus = (output.task_status ?? 'UNKNOWN') as string

      const VALID_TASK_STATUSES = ['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'UNKNOWN'] as const
      const status: ASRTaskStatus['status'] = (VALID_TASK_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus as ASRTaskStatus['status']
        : 'UNKNOWN'

      // SUCCEEDED 时从 results[] 提取转录 URL
      let transcriptionUrl: string | undefined
      let fileUrl: string | undefined
      if (status === 'SUCCEEDED' && Array.isArray(output.results)) {
        const result = output.results[0] as Record<string, unknown> | undefined
        transcriptionUrl = typeof result?.transcription_url === 'string' ? result.transcription_url : undefined
        fileUrl = typeof result?.file_url === 'string' ? result.file_url : undefined
      }

      // 使用量
      const usage = data.usage as Record<string, unknown> | undefined
      const durationSeconds = typeof usage?.duration === 'number' ? usage.duration : undefined

      const errorMessage = status === 'FAILED'
        ? parseDashScopeError(data)
        : (output.message ?? data.message) as string | undefined

      return {
        taskId,
        status,
        transcriptionUrl,
        fileUrl,
        durationSeconds,
        errorMessage: typeof errorMessage === 'string' ? errorMessage : undefined,
      }
    }
    catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      return {
        taskId,
        status: 'UNKNOWN',
        errorMessage: `网络错误：无法查询 ASR 任务状态（${msg}）`,
      }
    }
  }

  /**
   * 从 Paraformer 转录结果 JSON 中提取句子列表
   *
   * 转录 JSON 结构：
   *   transcripts[].sentences[] → SubtitleSentence[]
   * 每个 sentence 有 begin_time/end_time（毫秒）、text、words[]
   */
  parseTranscription(rawJson: unknown): SubtitleSentence[] {
    if (!rawJson || typeof rawJson !== 'object')
      return []

    const root = rawJson as Record<string, unknown>
    const transcripts = root.transcripts as Array<Record<string, unknown>> | undefined

    if (!transcripts || !Array.isArray(transcripts))
      return []

    const sentences: SubtitleSentence[] = []

    for (const transcript of transcripts) {
      const rawSentences = transcript.sentences as Array<Record<string, unknown>> | undefined
      if (!rawSentences || !Array.isArray(rawSentences))
        continue

      for (const s of rawSentences) {
        sentences.push({
          id: crypto.randomUUID(),
          text: typeof s.text === 'string' ? s.text : '',
          beginTime: typeof s.begin_time === 'number' ? s.begin_time : 0,
          endTime: typeof s.end_time === 'number' ? s.end_time : 0,
          ...(typeof s.speaker_id === 'number' && { speakerId: s.speaker_id }),
        })
      }
    }

    return sentences
  }
}
