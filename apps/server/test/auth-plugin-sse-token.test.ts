import type { ServerConfig } from '../src/config'
import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../src/plugins/auth'

/**
 * Auth Plugin SSE 认证测试
 *
 * SSE 连接只通过 Authorization: Bearer <jwt> 认证。
 * Query token (?token=<jwt>) 已移除 — JWT 不再暴露在 URL 中。
 *
 * 使用 @microsoft/fetch-event-source 的 SSE 客户端支持自定义 headers，
 * 所以 Bearer 认证完全可行，无需 query token fallback。
 */

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: '',
  dashscopeBaseUrl: '',
  storageRoot: '',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-sse-token-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
}

function createTestApp() {
  return new Elysia()
    .use(createAuthPlugin(testConfig))
    .post('/sign', async ({ jwt, body }) => {
      const { sub } = body as { sub: string }
      const token = await jwt.sign({ sub })
      return { token }
    }, {
      body: t.Object({ sub: t.String() }),
    })
    // 模拟 SSE 端点：只通过 Bearer header 认证
    .get('/sse-check', ({ userId }) => ({ userId }))
}

describe('auth plugin — SSE Bearer-only authentication', () => {
  it('should extract userId from Bearer header', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发 token
    const signRes = await client.sign.post({ sub: 'sse-user-123' })
    const token = (signRes.data as { token?: string } | null)?.token
    expect(token).toBeDefined()

    // 通过 Bearer header 认证
    const { data, error } = await client['sse-check'].get({
      headers: { Authorization: `Bearer ${token}` },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'sse-user-123' })
  })

  it('should return userId=null for invalid Bearer token', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client['sse-check'].get({
      headers: { Authorization: 'Bearer invalid.jwt.token' },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  it('should return userId=null when no token is provided', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client['sse-check'].get()

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  it('should NOT accept query ?token= (removed)', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发 token
    const signRes = await client.sign.post({ sub: 'query-attempt-user' })
    const token = (signRes.data as { token?: string } | null)?.token

    // Query token 不应被接受 — userId 应为 null（无 Bearer header）
    const { data, error } = await client['sse-check'].get({
      query: { token },
    })

    expect(error).toBeNull()
    // Query token 不再作为认证方式
    expect(data).toEqual({ userId: null })
  })
})