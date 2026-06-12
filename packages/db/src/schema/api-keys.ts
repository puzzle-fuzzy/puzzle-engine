import { index, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * API 密钥表
 *
 * 密钥只存 SHA-256 hash + 短前缀（用于展示识别）。
 * 创建时只返回一次完整 key，后续无法查看。
 */
export const apiKeys = pgTable('api_keys', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 密钥前 8 位，用于 UI 展示识别 */
  prefix: varchar('prefix', { length: 8 }).notNull(),
  /** SHA-256 hex digest of the full key */
  keyHash: text('key_hash').notNull().unique(),
  /** 用户给密钥起的名称 */
  name: varchar('name', { length: 100 }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, table => [
  index('idx_api_keys_account').on(table.accountId),
  index('idx_api_keys_hash').on(table.keyHash),
])
