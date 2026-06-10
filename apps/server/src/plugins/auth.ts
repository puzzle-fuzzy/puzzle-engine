import { Elysia, t } from 'elysia'
import { jwt } from '@elysia/jwt'
import { bearer } from '@elysia/bearer'
import type { ServerConfig } from '../config'

/**
 * 认证插件 — JWT + Bearer token 解析
 *
 * 使用 Elysia 回调式插件模式：(app) => app.use(...).derive(...)
 * 这是 ElysiaJS 的最佳实践，确保 derive 的类型变更传播到父级实例。
 *
 * @see https://elysiajs.com/plugins/jwt
 * @see https://elysiajs.com/plugins/bearer
 *
 * 注册后向上下文注入：
 *   - jwt: JWT 签发/验证实例（来自 @elysia/jwt）
 *   - bearer: Bearer token 原文（来自 @elysia/bearer）
 *   - userId: 从 JWT sub 提取的用户 ID（未认证时为 null）
 */
export const createAuthPlugin = (config: ServerConfig) => (app: Elysia) =>
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
