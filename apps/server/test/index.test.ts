import type { App } from '../src/index'
import { treaty } from '@elysia/eden'
import { describe, expect, it } from 'bun:test'
import app from '../src/index'

const client = treaty<App>(app)

describe('API', () => {
  it('GET / 应返回问候语', async () => {
    const { data, error } = await client.get()

    expect(error).toBeNull()
    expect(data).toBe('Hello, Elysia!')
  })
})
