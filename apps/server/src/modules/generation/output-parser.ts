/**
 * Provider 输出解析器
 *
 * DashScope provider 返回的类型化 output 联合：
 *   - TextProviderOutput   → text 生成结果
 *   - ImageProviderOutput  → image 生成结果
 *   - VideoTaskProviderOutput → 异步视频任务中间态
 *   - DashScopeTaskOutput  → 异步任务查询结果（外部 API 边界，含 index signature）
 *
 * 此模块在边界层完成类型解析，将 ProviderOutput 转为类型安全的 OutputResult 联合类型。
 * 不允许 unknown 泄漏到上层业务代码。
 */
import type { ImageOutputResult, OutputResult, ProcessingOutputResult, TextOutputResult, VideoOutputResult } from '@excuse/db'
import type { DashScopeTaskOutput, ImageProviderOutput, TextProviderOutput, VideoTaskProviderOutput } from '@excuse/provider'

type ProviderOutput = TextProviderOutput | ImageProviderOutput | VideoTaskProviderOutput | DashScopeTaskOutput

/**
 * 将 DashScope provider 返回的类型化 output 解析为 OutputResult。
 *
 * 使用 type 字段做辨识联合 narrowing：
 *   - type === 'text'     → TextProviderOutput → TextOutputResult
 *   - type === 'image'    → ImageProviderOutput → ImageOutputResult
 *   - type === 'processing' → VideoTaskProviderOutput → ProcessingOutputResult
 *   - DashScopeTaskOutput（有 index signature）→ 按字段检测映射
 */
export function parseProviderOutput(raw: ProviderOutput | undefined): OutputResult {
  if (!raw || typeof raw !== 'object') {
    return { type: 'text', text: '' }
  }

  // === 识别 ProviderOutput 子类型 ===
  // TextProviderOutput / ImageProviderOutput / VideoTaskProviderOutput 是封闭类型（固定字段），
  // DashScopeTaskOutput 是开放类型（有 index signature），所以 switch(raw.type) 无法精确 narrow。
  // 用 'raw' 字段存在性区分封闭类型 vs 开放类型：
  //   - 封闭类型都有 `raw: unknown` 字段（DashScope API 原始响应）
  //   - DashScopeTaskOutput 没有 `raw` 字段
  if ('raw' in raw) {
    switch (raw.type) {
      // TextProviderOutput: { type: 'text', text: string, raw: unknown }
      case 'text':
        return parseTextOutput(raw as TextProviderOutput)

      // ImageProviderOutput: { type: 'image', urls: string[], raw: unknown }
      case 'image':
        return parseImageOutput(raw as ImageProviderOutput)

      // VideoTaskProviderOutput: { type: 'processing', taskId: string, status: 'submitted', raw: unknown }
      case 'processing':
        return parseProcessingOutput(raw as VideoTaskProviderOutput)
    }
  }

  // === DashScopeTaskOutput（无 raw 字段，有 index signature）===
  return parseDashScopeTaskOutput(raw as DashScopeTaskOutput)
}

function parseTextOutput(raw: TextProviderOutput): TextOutputResult {
  return {
    type: 'text',
    text: raw.text,
  }
}

function parseImageOutput(raw: ImageProviderOutput): ImageOutputResult {
  return {
    type: 'image',
    savedUrls: [],
    urls: raw.urls,
  }
}

function parseProcessingOutput(raw: VideoTaskProviderOutput): ProcessingOutputResult {
  return {
    type: 'processing',
    taskId: raw.taskId,
    status: raw.status,
  }
}

/**
 * DashScopeTaskOutput 解析 — 按字段内容辨识
 *
 * DashScopeTaskOutput 有 index signature [key: string]: unknown，
 * 所以可以安全地按字段存在性判断类型。
 */
function parseDashScopeTaskOutput(raw: DashScopeTaskOutput): OutputResult {
  // 视频完成：有 video_url
  if (typeof raw.video_url === 'string') {
    const result: VideoOutputResult = {
      type: 'video',
      savedUrls: Array.isArray(raw.savedUrls) ? raw.savedUrls.filter((u): u is string => typeof u === 'string') : [],
      originalUrl: typeof raw.originalUrl === 'string' ? raw.originalUrl : undefined,
      video_url: raw.video_url,
    }
    return result
  }

  // 图片异步任务完成：有 results 数组
  if (Array.isArray(raw.results) && raw.results.length > 0) {
    const urls = raw.results
      .map(r => r.url || r.b64_image)
      .filter((u): u is string => typeof u === 'string')
    if (urls.length > 0) {
      const result: ImageOutputResult = { type: 'image', savedUrls: [], urls }
      return result
    }
  }

  // 异步任务中间态：有 taskId 或 status
  if (typeof raw.taskId === 'string' || typeof raw.status === 'string') {
    return {
      type: 'processing',
      taskId: typeof raw.taskId === 'string' ? raw.taskId : undefined,
      status: typeof raw.status === 'string' ? raw.status : undefined,
    }
  }

  // 兜底：无法辨识的 DashScope 输出
  return { type: 'text', text: '' }
}

/**
 * 从 provider output 中提取图片临时 URL 列表（用于 downloadAndMap）。
 *
 * 只当 output 是 ImageProviderOutput 时返回非空数组。
 * DashScopeTaskOutput 的图片 URL 在 results 字段，此处不提取
 * （worker 场景由 extractVideoUrl 处理）。
 */
export function extractImageUrls(raw: ImageProviderOutput | DashScopeTaskOutput | undefined): string[] {
  if (!raw)
    return []

  // ImageProviderOutput — type 辨识 narrowing
  if (raw.type === 'image') {
    return (raw as ImageProviderOutput).urls
  }

  // DashScopeTaskOutput — 图片异步任务结果
  if (Array.isArray(raw.urls)) {
    return raw.urls.filter((u): u is string => typeof u === 'string')
  }

  return []
}
