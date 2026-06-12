import type { ServerConfig } from '../config'
import { createApiKey, listApiKeysByAccount, revokeApiKey } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { notFound } from '../utils/errors'

/**
 * API 密钥管理路由
 *
 * POST   /api/keys      — 创建新密钥（返回完整 key，仅此一次）
 * GET    /api/keys      — 列出当前用户所有有效密钥
 * DELETE /api/keys/:id  — 撤销密钥
 */
export function createApiKeyRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/keys' })
    .use(createRequireAuthPlugin(config))
    .post('/', async ({ userId, body }) => {
      const rawKey = `exc_${crypto.randomUUID().replace(/-/g, '')}`
      const prefix = rawKey.slice(0, 8)
      const keyHash = await hashKey(rawKey)

      await createApiKey({
        accountId: userId,
        prefix,
        keyHash,
        name: body.name,
      })

      return { success: true, key: rawKey, prefix }
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 100 })),
      }),
      detail: {
        summary: '创建 API 密钥',
        description: '生成新密钥，完整 key 仅此一次返回，后续只展示前缀',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/', async ({ userId }) => {
      const keys = await listApiKeysByAccount(userId)
      return { success: true, keys }
    }, {
      detail: {
        summary: '列出 API 密钥',
        description: '返回当前用户所有有效（未撤销）的 API 密钥',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
    .delete('/:id', async ({ userId, params, set }) => {
      const revoked = await revokeApiKey(params.id, userId)
      if (!revoked)
        return notFound(set, '密钥不存在或已撤销')
      return { success: true }
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '撤销 API 密钥',
        description: '撤销指定密钥，撤销后立即失效',
        tags: ['API 密钥'],
        security: [{ bearerAuth: [] }],
      },
    })
}

async function hashKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')
}
