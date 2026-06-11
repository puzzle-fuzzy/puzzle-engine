import type { ServerConfig } from '../src/config'
import { describe, expect, it } from 'bun:test'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../src/plugins/auth'

/**
 * Auth Plugin SSE token fallback 测试
 *
 * 测试 ?token=<jwt> 查询参数认证（SSE 场景下 EventSource 不支持自定义 header）。
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
    // 模拟 SSE 端点：通过 query.token 认证
    .get('/sse-check', ({ userId }) => ({ userId }))
}

describe('auth plugin — SSE token fallback (?token=)', () => {
  it('should extract userId from query ?token=<jwt>', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发 token
    const signRes = await client.sign.post({ sub: 'sse-user-123' })
    const token = (signRes.data as any)?.token
    expect(token).toBeDefined()

    // 通过 query token 认证（模拟 EventSource 场景）
    const { data, error } = await client['sse-check'].get({
      query: { token },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: 'sse-user-123' })
  })

  it('should return userId=null for invalid query token', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client['sse-check'].get({
      query: { token: 'invalid.jwt.token' },
    })

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })

  it('should prefer Bearer header over query token when both present', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    // 签发两个 token，对应不同用户
    const signRes1 = await client.sign.post({ sub: 'header-user' })
    const headerToken = (signRes1.data as any)?.token

    const signRes2 = await client.sign.post({ sub: 'query-user' })
    const queryToken = (signRes2.data as any)?.token

    // 同时提供 Bearer header 和 query token → Bearer 优先
    const { data } = await client['sse-check'].get({
      query: { token: queryToken },
      headers: { Authorization: `Bearer ${headerToken}` },
    })

    expect(data).toEqual({ userId: 'header-user' })
  })

  it('should return userId=null when neither header nor query token is provided', async () => {
    const { treaty } = await import('@elysia/eden')
    const app = createTestApp()
    const client = treaty(app)

    const { data, error } = await client['sse-check'].get()

    expect(error).toBeNull()
    expect(data).toEqual({ userId: null })
  })
})
