import type { NotificationDTO, SSENotificationEvent } from '@excuse/shared'
import { create } from 'zustand'
import { api } from '@/api/client'

/**
 * 通知列表展示项 — NotificationDTO 去掉 accountId（SSE 事件不下发 accountId，
 * 列表展示也不需要；统一在此剥离避免类型不匹配）
 */
export type NotificationItem = Omit<NotificationDTO, 'accountId'>

interface NotificationsState {
  items: NotificationItem[]
  unreadCount: number
  /** 列表是否已加载（未加载时不向 items 合并 SSE 事件，避免无谓累积） */
  loaded: boolean
  loading: boolean

  fetchList: () => Promise<void>
  fetchUnread: () => Promise<void>
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
  /** SSE 'notification' 事件处理 — 前置到列表 + 未读数 +1 */
  handleSSEEvent: (event: SSENotificationEvent) => void
}

function toNotificationItem(row: NotificationDTO): NotificationItem {
  const { accountId: _accountId, ...rest } = row
  return rest
}

export const useNotificationsStore = create<NotificationsState>(set => ({
  items: [],
  unreadCount: 0,
  loaded: false,
  loading: false,

  fetchList: async () => {
    set({ loading: true })
    try {
      const res = await api.api.notifications.get()
      const data = res.data
      if (data?.success) {
        set({ items: data.items.map(toNotificationItem), loaded: true })
      }
    }
    catch {
      // 通知为非关键功能，静默失败
    }
    finally {
      set({ loading: false })
    }
  },

  fetchUnread: async () => {
    try {
      const res = await api.api.notifications.unread.get()
      const data = res.data
      if (data?.success) {
        set({ unreadCount: data.data.count })
      }
    }
    catch {
    }
  },

  markRead: async (id) => {
    // 乐观更新
    set(s => ({
      items: s.items.map(n => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, s.unreadCount - 1),
    }))
    try {
      await api.api.notifications({ id }).read.patch()
    }
    catch {
      // 失败由下次 fetch 修正
    }
  },

  markAllRead: async () => {
    set(s => ({
      items: s.items.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }))
    try {
      await api.api.notifications['read-all'].post()
    }
    catch {
    }
  },

  handleSSEEvent: (event) => {
    set(s => ({
      items: s.loaded
        ? [{ id: event.id, type: event.type as NotificationItem['type'], title: event.title, body: event.body ?? null, meta: event.meta ?? null, read: event.read, createdAt: event.createdAt }, ...s.items]
        : s.items,
      unreadCount: s.unreadCount + 1,
    }))
  },
}))
