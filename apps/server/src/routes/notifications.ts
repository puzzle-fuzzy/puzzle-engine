import type { MutationOkResponse, NotificationDTO, NotificationListResponse, NotificationReadAllResponse, NotificationUnreadCountResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createNotification, getUnreadCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '@excuse/db'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { dispatchToUser } from '../services/sse-manager'
import { notFound } from '../utils/errors'

function serializeNotification(row: {
  id: string
  accountId: string
  type: NotificationDTO['type']
  title: string
  body: string | null
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
 * 创建通知并通过 SSE 实时推送
 */
export async function pushNotification(opts: {
  accountId: string
  type: 'balance_warning' | 'task_completed' | 'task_failed' | 'api_key_expired' | 'system'
  title: string
  body?: string
}) {
  const { accountId, type, title, body } = opts

  const notification = await createNotification({
    accountId,
    type,
    title,
    body: body ?? null,
  })

  // 通过 SSE 实时推送
  dispatchToUser(accountId, 'notification', {
    id: notification.id,
    type,
    title,
    body,
    read: false,
    createdAt: notification.createdAt.toISOString(),
  })

  return notification
}
