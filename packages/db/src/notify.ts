import type { GenerationNotifyPayload, NotificationMeta } from './domain-types'
import type { NotificationInsert } from './types'
import { pgClient } from './db'
import { createNotification } from './repositories/notifications.repo'

/**
 * 通过 PostgreSQL NOTIFY 通知 Server 端生成状态变更
 * Worker 在更新 DB 后调用，Server 端通过 LISTEN 接收并推送到 SSE 客户端
 */
export async function notifyGenerationStatus(payload: GenerationNotifyPayload) {
  await pgClient.notify('generation_status', JSON.stringify(payload))
}

/**
 * NOTIFY 频道名 — 与 @excuse/events 的 NOTIFICATION_CHANNEL 保持一致。
 * db 不依赖 events（两者同层，均仅依赖 shared），故此处硬编码字符串。
 */
const NOTIFICATION_CHANNEL = 'notification'

export interface NotifyNotificationOpts {
  accountId: string
  type: NotificationInsert['type']
  title: string
  body?: string
  /** 结构化定位元数据，供前端「点击定位」（P2-2） */
  meta?: NotificationMeta
}

/**
 * 创建通知并通过 PostgreSQL NOTIFY 推送给 Server 端 SSE。
 *
 * Worker 与 Server 自身均通过此函数发通知：写入 notifications 表后 notify，
 * Server 的 startSSEListener 监听 NOTIFICATION_CHANNEL 并 dispatchToUser。
 * 这样 worker（无法 import server 的 pushNotification）与 server 共用同一路径。
 */
export async function notifyNotification(opts: NotifyNotificationOpts) {
  const row = await createNotification({
    accountId: opts.accountId,
    type: opts.type,
    title: opts.title,
    body: opts.body ?? null,
    meta: opts.meta ?? null,
  })

  await pgClient.notify(NOTIFICATION_CHANNEL, JSON.stringify({
    id: row.id,
    accountId: row.accountId,
    type: row.type,
    title: row.title,
    body: row.body,
    meta: row.meta,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  }))

  return row
}
