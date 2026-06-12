import { and, desc, eq, isNull } from 'drizzle-orm'
import { getDb } from '../db'
import { apiKeys } from '../schema/api-keys'

export async function createApiKey(values: {
  accountId: string
  prefix: string
  keyHash: string
  name?: string
}) {
  const [key] = await getDb()
    .insert(apiKeys)
    .values(values)
    .returning()
  return key!
}

export async function listApiKeysByAccount(accountId: string) {
  return getDb()
    .select({
      id: apiKeys.id,
      prefix: apiKeys.prefix,
      name: apiKeys.name,
      lastUsedAt: apiKeys.lastUsedAt,
      createdAt: apiKeys.createdAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .where(and(eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .orderBy(desc(apiKeys.createdAt))
}

export async function findApiKeyByHash(keyHash: string) {
  const [key] = await getDb()
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
    .limit(1)
  return key ?? null
}

export async function revokeApiKey(id: string, accountId: string) {
  const [updated] = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.accountId, accountId), isNull(apiKeys.revokedAt)))
    .returning()
  return updated ?? null
}

export async function touchApiKeyLastUsed(id: string) {
  await getDb()
    .update(apiKeys)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiKeys.id, id))
}
