import type { Elysia } from 'elysia'
import type { ServerConfig } from '../config'
import { bearer } from '@elysia/bearer'
import { jwt } from '@elysia/jwt'
import { cookie } from '@elysiajs/cookie'
import { status, t } from 'elysia'

/** httpOnly cookie 名称 */
export const AUTH_COOKIE_NAME = 'auth_token'

/**
 * 认证插件 — JWT 解析（httpOnly cookie 优先，Authorization header 回退）
 *
 * 认证优先级:
 *   1. httpOnly cookie（浏览器自动发送，XSS 无法窃取）
 *   2. Authorization: Bearer header（API 调用、SSE 连接）
 *
 * 注册后向上下文注入：
 *   - jwt: JWT 签发/验证实例
 *   - bearer: Bearer token 原文
 *   - userId: 从 JWT sub 提取的用户 ID（未认证时为 null）
 */
export function createAuthPlugin(config: ServerConfig) {
  return (app: Elysia) =>
    app
      .use(cookie())
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
      .derive(async ({ jwt, bearer, cookie: cookies }) => {
        // 优先从 httpOnly cookie 读取
        const cookieToken = cookies[AUTH_COOKIE_NAME]?.value as string | undefined
        const token = cookieToken || bearer

        if (!token || typeof token !== 'string') {
          return { userId: null }
        }
        const payload = await jwt.verify(token)
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
