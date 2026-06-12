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
 * 认证方式: Authorization: Bearer <token>
 * SSE 连接也使用 Bearer header（通过 @microsoft/fetch-event-source 自定义 headers）。
 * Query token 已移除 — JWT 不再暴露在 URL 中（避免日志泄露风险）。
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
      .derive(async ({ jwt, bearer }) => {
        if (!bearer) {
          return { userId: null }
        }
        const payload = await jwt.verify(bearer)
        if (!payload) {
          return { userId: null }
        }
        return { userId: payload.sub }
      })
}
