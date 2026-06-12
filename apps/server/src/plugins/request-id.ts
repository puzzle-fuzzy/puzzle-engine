import { randomUUID } from 'node:crypto'
import { Elysia } from 'elysia'

/**
 * Request ID 插件
 *
 * 为每个 HTTP 请求生成唯一 requestId，附加到响应头和 logger context。
 * 用于跨服务追踪请求链路。
 */
export const requestIdPlugin = new Elysia()
  .derive(({ set }) => {
    const requestId = randomUUID()
    set.headers['X-Request-Id'] = requestId
    return { requestId }
  })
