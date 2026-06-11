import type { Elysia } from 'elysia'
import type { ServerConfig } from '../config'
import { bearer } from '@elysia/bearer'
import { jwt } from '@elysia/jwt'
import { t } from 'elysia'

/**
 * 认证插件 — JWT + Bearer token 解析
 *
 * 使用 Elysia 回调式插件模式：(app) => app.use(...).derive(...)
 * 这是 ElysiaJS 的最佳实践，确保 derive 的类型变更传播到父级实例。
 *
 * 支持两种认证方式：
 *   1. Authorization: Bearer <token>（常规 HTTP 请求）
 *   2. ?token=<jwt>（SSE 连接，因为 EventSource 不支持自定义 header）
 *
 * @see https://elysiajs.com/plugins/jwt
 * @see https://elysiajs.com/plugins/bearer
 *
 * 注册后向上下文注入：
 *   - jwt: JWT 签发/验证实例（来自 @elysia/jwt）
 *   - bearer: Bearer token 原文（来自 @elysia/bearer）
 *   - userId: 从 JWT sub 提取的用户 ID（未认证时为 null）
 */
export function createAuthPlugin(config: ServerConfig) {
  return (app: Elysia) =>
    app
      .use(bearer())
      .use(
        jwt({
          name: 'jwt',
          secret: config.jwtSecret,
          schema: t.Object({
            sub: t.String(),
          }),
          exp: config.jwtExpiresIn,
        }),
      )
      .derive(async ({ jwt, bearer, query }) => {
      // 优先使用 Bearer header，回退到 query token（SSE 场景）
        const token = bearer || (query as Record<string, unknown>)?.token as string | undefined
        if (!token) {
          return { userId: null }
        }
        const payload = await jwt.verify(token)
        if (!payload) {
          return { userId: null }
        }
        return { userId: payload.sub }
      })
}
