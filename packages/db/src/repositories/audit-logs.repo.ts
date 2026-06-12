import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { getDb } from '../db'
import { auditLogs } from '../schema/audit-logs'

export async function createAuditLog(values: {
  accountId?: string
  action: 'login' | 'register' | 'generate' | 'file_delete' | 'billing_transaction' | 'api_key_create' | 'api_key_revoke' | 'admin_action'
  targetId?: string
  detail?: Record<string, unknown>
  ip?: string
}) {
  await getDb().insert(auditLogs).values(values)
}

export async function queryAuditLogs(filters: {
  accountId?: string
  action?: string
  from?: Date
  to?: Date
  limit?: number
  offset?: number
}) {
  const conditions = []
  if (filters.accountId)
    conditions.push(eq(auditLogs.accountId, filters.accountId))
  if (filters.action)
    conditions.push(eq(auditLogs.action, filters.action as typeof auditLogs.action.enumValues[number]))
  if (filters.from)
    conditions.push(gte(auditLogs.createdAt, filters.from))
  if (filters.to)
    conditions.push(lte(auditLogs.createdAt, filters.to))

  return getDb()
    .select()
    .from(auditLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(auditLogs.createdAt))
    .limit(filters.limit ?? 100)
    .offset(filters.offset ?? 0)
}
