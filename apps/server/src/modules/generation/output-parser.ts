import type { ImageOutputResult, OutputResult, ProcessingOutputResult, TextOutputResult, VideoOutputResult } from '@excuse/db'

/**
 * 将 DashScope provider 返回的原始 JSON 解析为类型安全的 OutputResult。
 *
 * Provider output 是 `Record<string, unknown>` — DashScope API 返回的非结构化 JSON。
 * 此函数在边界层完成类型解析，不允许 `unknown` 泄漏到业务代码。
 *
 * 解析规则：
 * - 显式 `type: 'text'` + text 字段 → TextOutputResult
 * - 有 `urls` 数组 → ImageOutputResult（待下载）
 * - 有 `savedUrls` 数组 → ImageOutputResult（已保存）
 * - 有 `video_url` 或 `originalUrl` → VideoOutputResult
 * - 有 `taskId` 或 `status` → ProcessingOutputResult（异步任务中间态）
 * - 兜底 → TextOutputResult（空文本）
 */
export function parseProviderOutput(raw: Record<string, unknown> | undefined): OutputResult {
  if (!raw || typeof raw !== 'object') {
    return { type: 'text', text: '' }
  }

  // 显式 type 字段优先
  if (raw.type === 'text') {
    return parseTextOutput(raw)
  }

  if (raw.type === 'processing') {
    return parseProcessingOutput(raw)
  }

  // 图片：DashScope 图像生成返回 `urls` 数组（临时 URL）
  if (Array.isArray(raw.urls)) {
    const urls = raw.urls.filter((u): u is string => typeof u === 'string')
    const savedUrls = Array.isArray(raw.savedUrls)
      ? raw.savedUrls.filter((u): u is string => typeof u === 'string')
      : [] as const
    const result: ImageOutputResult = { type: 'image', savedUrls: [...savedUrls], urls }
    return result
  }

  // 图片（仅 savedUrls，无原始 urls）
  if (Array.isArray(raw.savedUrls)) {
    const savedUrls = raw.savedUrls.filter((u): u is string => typeof u === 'string')
    const result: ImageOutputResult = { type: 'image', savedUrls }
    return result
  }

  // 视频：DashScope 视频任务完成返回 video_url 或 originalUrl
  if (typeof raw.video_url === 'string' || typeof raw.originalUrl === 'string') {
    const result: VideoOutputResult = {
      type: 'video',
      savedUrls: Array.isArray(raw.savedUrls) ? raw.savedUrls.filter((u): u is string => typeof u === 'string') : [],
      originalUrl: typeof raw.originalUrl === 'string' ? raw.originalUrl : undefined,
      video_url: typeof raw.video_url === 'string' ? raw.video_url : undefined,
    }
    return result
  }

  // 文本：有 text 字段但无 type
  if (typeof raw.text === 'string') {
    return { type: 'text', text: raw.text }
  }

  // 异步任务中间态：有 taskId 或 status 但无明确 type
  if (typeof raw.taskId === 'string' || typeof raw.status === 'string') {
    return parseProcessingOutput(raw)
  }

  // 兜底：无法识别的输出结构
  return { type: 'text', text: '' }
}

function parseTextOutput(raw: Record<string, unknown>): TextOutputResult {
  return {
    type: 'text',
    text: typeof raw.text === 'string' ? raw.text : '',
  }
}

function parseProcessingOutput(raw: Record<string, unknown>): ProcessingOutputResult {
  return {
    type: 'processing',
    taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
  }
}

/**
 * 从 provider output 中提取图片临时 URL 列表（用于 downloadAndMap）。
 *
 * 在 provider 返回的原始 output 中，DashScope 图片任务的 URLs 在 `urls` 字段。
 * 只有当 output 是图片类型且包含 urls 时才返回非空数组。
 */
export function extractImageUrls(raw: Record<string, unknown> | undefined): string[] {
  if (!raw) return []
  if (!Array.isArray(raw.urls)) return []
  return raw.urls.filter((u): u is string => typeof u === 'string')
}
