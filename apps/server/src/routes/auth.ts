import type { AccountRow } from '@excuse/db'
import type { AuthUser } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createAccount, getAccountByEmail, getAccountById, getAccountByUsername } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { conflict, forbidden, notFound, unauthorized } from '../utils/errors'

/**
 * 从账户行中剥离密码哈希并序列化 Date→string，返回 AuthUser DTO
 *
 * 关键：不能直接 spread DB row — createdAt/updatedAt 是 Date 对象，
 * JSON.stringify(Date) 产生字符串但 JSON.parse 后变回字符串，
 * 导致类型不匹配（运行时是 string 但 TypeScript 认为是 Date）。
 * 必须显式 .toISOString() 确保 DTO 类型与 AuthUser 定义一致。
 */
function sanitizeUser(account: AccountRow): AuthUser {
  const { password: _, createdAt, updatedAt, ...rest } = account
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  }
}

/**
 * 认证路由 — 注册 / 登录 / 获取当前用户
 */
export function createAuthRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/auth' })
    .use(createAuthPlugin(config))
    // 注册
    .post('/register', async ({ body, jwt, set }) => {
      const { username, email, password } = body

      // 检查邮箱是否已注册
      const existingEmail = await getAccountByEmail(email)
      if (existingEmail) {
        return conflict(set, '该邮箱已被注册')
      }

      // 检查用户名是否已存在
      const existingUsername = await getAccountByUsername(username)
      if (existingUsername) {
        return conflict(set, '该用户名已被使用')
      }

      // 使用 Bun 内置 bcrypt 哈希密码
      const hashedPassword = await Bun.password.hash(password, 'bcrypt')

      // 创建账户
      const account = await createAccount({
        username,
        email,
        password: hashedPassword,
        isActive: true,
      })

      // 签发 JWT
      const token = await jwt.sign({ sub: account.id })

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
    .post('/login', async ({ body, jwt, set }) => {
      const { email, password } = body

      // 查找账户
      const account = await getAccountByEmail(email)
      if (!account) {
        return unauthorized(set, '邮箱或密码错误')
      }

      // 验证密码
      const valid = await Bun.password.verify(password, account.password, 'bcrypt')
      if (!valid) {
        return unauthorized(set, '邮箱或密码错误')
      }

      // 检查账户状态
      if (!account.isActive) {
        return forbidden(set, '账户已被禁用')
      }

      // 签发 JWT
      const token = await jwt.sign({ sub: account.id })

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
