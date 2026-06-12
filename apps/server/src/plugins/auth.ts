import type { Elysia } from 'elysia'
import type { ServerConfig } from '../config'
import { bearer } from '@elysia/bearer'
import { jwt } from '@elysia/jwt'
import { status, t } from 'elysia'

/**
 * 认证插件 — JWT + Bearer token 解析
 *
 * 使用 Elysia 回调式插件模式：(app) => app.use(...).derive(...)
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

/**
 * 认证守卫插件 — resolve 模式自动拦截未登录请求
 *
 * 内部使用 createAuthPlugin 解析 JWT 获得 userId，
 * 然后通过 resolve 验证 userId 是否存在：
 *   - 未登录 → 直接返回 401 响应
 *   - 已登录 → 将 userId 类型从 string | null 收窄为 string
 *
 * 适用于所有路由都需要认证的路由组（canvas、generate、billing 等）。
 * 混合公开/受保护路由的场景（如 auth.ts 的 register+login+/me）
 * 应继续使用 createAuthPlugin 并手动检查。
 */
export function createRequireAuthPlugin(config: ServerConfig) {
  return (app: Elysia) =>
    app
      .use(createAuthPlugin(config))
      .resolve(({ userId }) => {
        if (!userId) {
          return status(401, { success: false, error: '请先登录' })
        }
        return { userId }
      })
}
