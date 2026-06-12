import type { AccountRow } from '@excuse/db'
import type { AuthUser } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createAccount, getAccountByEmail, getAccountById, getAccountByUsername } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createAuthPlugin, AUTH_COOKIE_NAME } from '../plugins/auth'
import { audit } from '../services/audit'
import { conflict, forbidden, notFound, unauthorized } from '../utils/errors'

/**
 * 从账户行中剥离密码哈希并序列化 Date→string，返回 AuthUser DTO
 */
function sanitizeUser(account: AccountRow): AuthUser {
  const { password: _, createdAt, updatedAt, ...rest } = account
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

/** httpOnly cookie 配置 */
const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/api',
  maxAge: 7 * 24 * 3600,
}

/**
 * 认证路由 — 注册 / 登录 / 登出 / 获取当前用户
 */
export function createAuthRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/auth' })
    .use(createAuthPlugin(config))
    // 注册
    .post('/register', async ({ body, jwt, set, cookie: cookies }) => {
      const { username, email, password } = body

      const existingEmail = await getAccountByEmail(email)
      if (existingEmail) {
        return conflict(set, '该邮箱已被注册')
      }

      const existingUsername = await getAccountByUsername(username)
      if (existingUsername) {
        return conflict(set, '该用户名已被使用')
      }

      const hashedPassword = await Bun.password.hash(password, 'bcrypt')

      const account = await createAccount({
        username,
        email,
        password: hashedPassword,
        isActive: true,
      })

      const token = await jwt.sign({ sub: account.id })

      audit('register', { accountId: account.id })

      cookies[AUTH_COOKIE_NAME]?.set({ value: token, ...COOKIE_OPTS })

      return {
        success: true,
        token,
        user: sanitizeUser(account),
      }
    }, {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 6, maxLength: 100 }),
      }),
      detail: {
        summary: '用户注册',
        description: '创建新账户，返回 JWT token 和用户信息。邮箱和用户名不可重复。',
        tags: ['认证'],
      },
    })

    // 登录
    .post('/login', async ({ body, jwt, set, request, cookie: cookies }) => {
      const { email, password } = body

      const account = await getAccountByEmail(email)
      if (!account) {
        return unauthorized(set, '邮箱或密码错误')
      }

      const valid = await Bun.password.verify(password, account.password, 'bcrypt')
      if (!valid) {
        return unauthorized(set, '邮箱或密码错误')
      }

      if (!account.isActive) {
        return forbidden(set, '账户已被禁用')
      }

      const token = await jwt.sign({ sub: account.id })

      audit('login', { accountId: account.id, ip: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() })

      cookies[AUTH_COOKIE_NAME]?.set({ value: token, ...COOKIE_OPTS })

      return {
        success: true,
        token,
        user: sanitizeUser(account),
      }
    }, {
      body: t.Object({
        email: t.String(),
        password: t.String(),
      }),
      detail: {
        summary: '用户登录',
        description: '验证邮箱和密码，返回 JWT token 和用户信息。账户被禁用时返回 403。',
        tags: ['认证'],
      },
    })

    // 登出 — 清除 cookie
    .post('/logout', async ({ cookie: cookies }) => {
      cookies[AUTH_COOKIE_NAME]?.remove()
      return { success: true }
    }, {
      detail: {
        summary: '登出',
        description: '清除 httpOnly 认证 cookie',
        tags: ['认证'],
      },
    })

    // 获取当前用户信息
    .get('/me', async ({ userId, set }) => {
      if (!userId) {
        return unauthorized(set, '未登录')
      }

      const account = await getAccountById(userId)
      if (!account) {
        return notFound(set, '用户不存在')
      }

      return {
        success: true,
        user: sanitizeUser(account),
      }
    }, {
      detail: {
        summary: '获取当前用户信息',
        description: '根据 JWT token 返回当前登录用户的完整资料（不含密码哈希）',
        tags: ['认证'],
        security: [{ bearerAuth: [] }],
      },
    })
}
