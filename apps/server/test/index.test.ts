import type { App } from '../src/index'
import { treaty } from '@elysia/eden'
import { describe, expect, it } from 'bun:test'
import app from '../src/index'

const client = treaty<App>(app)

describe('API', () => {
  it('GET /api/health 应返回 status + timestamp + uptime + db', async () => {
    const { data, error } = await client.api.health.get()

    expect(error).toBeNull()
    expect(data?.status).toBeDefined()
    expect(data?.timestamp).toBeDefined()
    expect(typeof data?.uptime).toBe('number')
    expect(typeof data?.db).toBe('string')
  })
})
