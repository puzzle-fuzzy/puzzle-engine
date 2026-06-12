/**
 * 按类别的滑动窗口限流器
 *
 * 视频模型等高成本生成需要比全局 60/min 更严格的独立限流。
 * 基于 in-memory 滑动窗口，无需 Redis。
 */

interface WindowEntry {
  timestamps: number[]
}

const windows = new Map<string, WindowEntry>()

function cleanup(key: string, now: number, windowMs: number) {
  const entry = windows.get(key)
  if (!entry)
    return
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs)
  if (entry.timestamps.length === 0)
    windows.delete(key)
}

/** 检查是否允许请求。返回 { allowed, retryAfterSec } */
export function checkCategoryRateLimit(opts: {
  userId: string
  category: string
  maxRequests: number
  windowMs: number
}): { allowed: boolean, retryAfterSec: number } {
  const { userId, category, maxRequests, windowMs } = opts
  const key = `${userId}:${category}`
  const now = Date.now()

  cleanup(key, now, windowMs)

  const entry = windows.get(key)
  if (!entry) {
    windows.set(key, { timestamps: [now] })
    return { allowed: true, retryAfterSec: 0 }
  }

  if (entry.timestamps.length >= maxRequests) {
    const oldest = entry.timestamps[0]!
    const retryAfterMs = oldest + windowMs - now
    return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) }
  }

  entry.timestamps.push(now)
  return { allowed: true, retryAfterSec: 0 }
}

/** 清空限流窗口（仅用于测试） */
export function resetCategoryRateLimit() {
  windows.clear()
}
