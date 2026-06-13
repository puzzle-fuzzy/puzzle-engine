import { SlidingWindowRateLimiter } from '@excuse/rate-limit'

const limiter = new SlidingWindowRateLimiter()

/** 检查是否允许请求。返回 { allowed, retryAfterSec } */
export function checkCategoryRateLimit(opts: {
  userId: string
  category: string
  maxRequests: number
  windowMs: number
}): { allowed: boolean, retryAfterSec: number } {
  return limiter.check(opts)
}

/** 清空限流窗口（仅用于测试） */
export function resetCategoryRateLimit() {
  limiter.reset()
}
