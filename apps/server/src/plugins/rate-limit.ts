import { rateLimit } from 'elysia-rate-limit'

/**
 * 限流插件
 *
 * 全局每用户每分钟 60 次请求。
 * 超限返回 429 + Retry-After + 可展示中文错误信息。
 */
export const rateLimitPlugin = rateLimit({
  duration: 60 * 1000,
  max: 60,
  headers: true,
  generator: (request: Request) => {
    const authHeader = request.headers.get('authorization')
    if (authHeader)
      return `user:${authHeader.slice(0, 50)}`
    return `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`
  },
  errorResponse: new Response(JSON.stringify({
    success: false,
    error: '请求过于频繁，请稍后再试',
    retryAfter: 60,
  }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '60' },
  }),
})
