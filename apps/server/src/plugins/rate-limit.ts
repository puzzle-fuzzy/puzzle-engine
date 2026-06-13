import { buildRateLimitKey, createRateLimitErrorResponse, DEFAULT_GLOBAL_RATE_LIMIT } from '@excuse/rate-limit'
import { rateLimit } from 'elysia-rate-limit'

/**
 * 限流插件
 *
 * 全局每用户每分钟 60 次请求。
 * 超限返回 429 + Retry-After + 可展示中文错误信息。
 */
export const rateLimitPlugin = rateLimit({
  duration: DEFAULT_GLOBAL_RATE_LIMIT.durationMs,
  max: DEFAULT_GLOBAL_RATE_LIMIT.max,
  headers: true,
  generator: buildRateLimitKey,
  errorResponse: createRateLimitErrorResponse(),
})
