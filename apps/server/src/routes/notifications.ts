import type { NotificationMeta } from '@excuse/db'
import type { MutationOkResponse, NotificationDTO, NotificationListResponse, NotificationReadAllResponse, NotificationUnreadCountResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead, notifyNotification } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { notFound } from '../utils/errors'

function serializeNotification(row: {
  id: string
  accountId: string
  type: NotificationDTO['type']
  title: string
  body: string | null
  meta: NotificationDTO['meta']
  read: boolean
  createdAt: Date
}): NotificationDTO {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
  }
}

/**
 * 通知路由
 *
 * GET    /api/notifications         — 列出通知（分页）
 * GET    /api/notifications/unread   — 未读数量
 * PATCH  /api/notifications/:id/read — 标记已读
 * POST   /api/notifications/read-all — 全部已读
 */
export function createNotificationRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/notifications' })
    .use(createRequireAuthPlugin(config))
    .get('/', async ({ userId, query }) => {
      const notifications = await listNotifications({
        accountId: userId,
        limit: query.limit ?? 50,
        offset: query.offset ?? 0,
      })
      const serialized = notifications.map(serializeNotification)
      return {
        success: true,
        items: serialized,
        total: serialized.length,
      } satisfies NotificationListResponse
    }, {
      query: t.Object({
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
      detail: {
        summary: '获取通知列表',
        description: '分页查询当前用户的通知，按时间倒序',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/unread', async ({ userId }) => {
      const count = await getUnreadCount(userId)
      return {
        success: true,
        data: { count },
      } satisfies NotificationUnreadCountResponse
    }, {
      detail: {
        summary: '获取未读数量',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .patch('/:id/read', async ({ userId, params, set }) => {
      const updated = await markNotificationRead(params.id, userId)
      if (!updated) {
        return notFound(set, '通知不存在')
      }
      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: '标记通知已读',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
    .post('/read-all', async ({ userId }) => {
      const count = await markAllNotificationsRead(userId)
      return {
        success: true,
        data: { count },
      } satisfies NotificationReadAllResponse
    }, {
      detail: {
        summary: '全部标记已读',
        tags: ['通知'],
        security: [{ bearerAuth: [] }],
      },
    })
}

/**
 * 创建通知并通过 SSE 实时推送（P2-2）
 *
 * 委托给 db 的 `notifyNotification()`：写入 notifications 表 + pgClient.notify，
 * 由 server 自身的 startSSEListener 监听 notification 频道后 dispatchToUser。
 * 这样 server 触发的通知与 worker 触发的通知共用完全相同的下发路径。
 */
export async function pushNotification(opts: {
  accountId: string
  type: 'balance_warning' | 'task_completed' | 'task_failed' | 'canvas_completed' | 'api_key_expired' | 'system'
  title: string
  body?: string
  meta?: NotificationMeta
}) {
  return notifyNotification(opts)
}

/**
 * 余额不足通知（P2-2） — reserveCredit 失败（INSUFFICIENT_BALANCE）时调用，
 * 前端按 type=balance_warning 点击跳转到计费页。
 */
export async function notifyInsufficientBalance(accountId: string) {
  return pushNotification({
    accountId,
    type: 'balance_warning',
    title: '余额不足',
    body: '信用额度不足，部分操作无法完成，请前往计费页查看',
  })
}
