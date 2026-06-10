import { Elysia, t } from 'elysia'
import { getAccountByEmail, getAccountByUsername, getAccountById, createAccount } from '@excuse/db'
import type { AccountRow } from '@excuse/db'
import type { ServerConfig } from '../config'
import { createAuthPlugin } from '../plugins/auth'

/**
 * 从账户行中剥离密码哈希，安全返回给客户端
 */
function sanitizeUser(account: AccountRow) {
  const { password: _, ...safe } = account
  return safe
}

/**
 * 认证路由 — 注册 / 登录 / 获取当前用户
 */
export function createAuthRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/auth' })
    .use(createAuthPlugin(config))
    // 注册
    .post('/register', async ({ body, jwt }) => {
      const { username, email, password } = body as {
        username: string
        email: string
        password: string
      }

      // 检查邮箱是否已注册
      const existingEmail = await getAccountByEmail(email)
      if (existingEmail) {
        return { success: false, error: '该邮箱已被注册' }
      }

      // 检查用户名是否已存在
      const existingUsername = await getAccountByUsername(username)
      if (existingUsername) {
        return { success: false, error: '该用户名已被使用' }
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
    })

    // 登录
    .post('/login', async ({ body, jwt }) => {
      const { email, password } = body as {
        email: string
        password: string
      }

      // 查找账户
      const account = await getAccountByEmail(email)
      if (!account) {
        return { success: false, error: '邮箱或密码错误' }
      }

      // 验证密码
      const valid = await Bun.password.verify(password, account.password, 'bcrypt')
      if (!valid) {
        return { success: false, error: '邮箱或密码错误' }
      }

      // 检查账户状态
      if (!account.isActive) {
        return { success: false, error: '账户已被禁用' }
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
    })

    // 获取当前用户信息
    .get('/me', async ({ userId }) => {
      if (!userId) {
        return { success: false, error: '未登录' }
      }

      const account = await getAccountById(userId)
      if (!account) {
        return { success: false, error: '用户不存在' }
      }

      return {
        success: true,
        user: sanitizeUser(account),
      }
    })
}
