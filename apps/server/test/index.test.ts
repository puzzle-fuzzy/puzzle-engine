import type { App } from '../src/index'
import { treaty } from '@elysia/eden'
import { describe, expect, it } from 'bun:test'
import app from '../src/index'

const client = treaty<App>(app)

describe('API', () => {
  it('GET /api/health 应返回 ok', async () => {
    const { data, error } = await client.api.health.get()

    expect(error).toBeNull()
    expect(data?.status).toBe('ok')
  })
})
