import { logger } from '@excuse/shared'
import { Elysia } from 'elysia'

/**
 * HTTP 请求日志插件
 *
 * 基于 pino，自动记录每个请求的：
 *   - method, url, status, response-time
 *   - 请求进入 / 响应返回 / 错误
 *
 * 同时将 logger 实例挂载到 Elysia context，
 * 路由 handler 中可通过 context.log 使用。
 */
export const loggerPlugin = new Elysia({
  name: 'logger',
})
  .state('_reqStart', 0)
  .derive(() => ({
    log: logger,
  }))
  .onBeforeHandle(({ request, store, log }) => {
    store._reqStart = performance.now()
    const method = request.method
    const url = new URL(request.url).pathname

    log.info({ req: { method, url } }, '← request incoming')
  })
  .onAfterHandle(({ request, store, log, set }) => {
    const start = store._reqStart
    const duration = start ? Number((performance.now() - start).toFixed(2)) : -1
    const method = request.method
    const url = new URL(request.url).pathname
    const status = set.status ?? 200

    log.info({ res: { method, url, status, duration: `${duration}ms` } }, '→ response sent')
  })
  .onError(({ request, error, log, set }) => {
    const method = request.method
    const url = new URL(request.url).pathname

    log?.error({ err: error, res: { method, url } }, 'Unhandled error')

    // 返回结构化 500 JSON 错误体 — 与 utils/errors.ts 格式一致
    set.status = 500
    return { success: false, error: '服务端内部错误' }
  })
