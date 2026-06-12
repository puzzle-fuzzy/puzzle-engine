import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { notifications } from '../schema'
import type { NotificationInsert, NotificationRow } from '../types'

/** 创建通知 */
export async function createNotification(values: NotificationInsert): Promise<NotificationRow> {
  const [row] = await getDb().insert(notifications).values(values).returning()
  return row!
}

/** 查询用户通知（分页） */
export async function listNotifications(opts: {
  accountId: string
  limit?: number
  offset?: number
}): Promise<NotificationRow[]> {
  const { accountId, limit = 50, offset = 0 } = opts
  return getDb()
    .select()
    .from(notifications)
    .where(eq(notifications.accountId, accountId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit)
    .offset(offset)
}

/** 获取未读数量 */
export async function getUnreadCount(accountId: string): Promise<number> {
  const [result] = await getDb()
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.accountId, accountId), eq(notifications.read, false)))
  return result?.count ?? 0
}

/** 标记单条已读 */
export async function markNotificationRead(id: string, accountId: string): Promise<boolean> {
  const [updated] = await getDb()
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.id, id), eq(notifications.accountId, accountId)))
    .returning()
  return !!updated
}

/** 标记全部已读 */
export async function markAllNotificationsRead(accountId: string): Promise<number> {
  const result = await getDb()
    .update(notifications)
    .set({ read: true })
    .where(and(eq(notifications.accountId, accountId), eq(notifications.read, false)))
    .returning()
  return result.length
}
