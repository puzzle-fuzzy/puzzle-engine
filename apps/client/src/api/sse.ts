import { getAuthToken } from './client'
import type { SSEGenerationStatusEvent, SSENotificationEvent } from '@excuse/shared'

type GenerationStatusHandler = (event: SSEGenerationStatusEvent) => void
type NotificationHandler = (event: SSENotificationEvent) => void
type EventHandler = GenerationStatusHandler | NotificationHandler

/**
 * SSE 客户端 — 管理与服务器的实时连接
 *
 * 使用浏览器原生 EventSource API:
 *   - 自动重连（连接断开后延迟 3 秒重试）
 *   - 事件类型分发（generation_status / notification / heartbeat）
 *   - 认证 token 通过 query 参数传递（EventSource 不支持自定义 header）
 */
class SSEClient {
  private eventSource: EventSource | null = null
  private handlers = new Map<string, Set<EventHandler>>()
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false

  /**
   * 建立 SSE 连接
   * 仅在已认证时（有 token）才连接
   */
  connect() {
    if (this.eventSource) return // 已连接

    const token = getAuthToken()
    if (!token) return // 未认证，不连接

    this.intentionallyClosed = false
    // 通过 Vite dev proxy: /api → localhost:5007
    this.eventSource = new EventSource(`/api/sse?token=${encodeURIComponent(token)}`)

    // 生成状态事件
    this.eventSource.addEventListener('generation_status', (e) => {
      try {
        const data: SSEGenerationStatusEvent = JSON.parse(e.data)
        this.emit('generation_status', data)
      }
      catch (err) {
        console.error('[SSE] Failed to parse generation_status event:', err)
      }
    })

    // 通知事件（预留）
    this.eventSource.addEventListener('notification', (e) => {
      try {
        const data: SSENotificationEvent = JSON.parse(e.data)
        this.emit('notification', data)
      }
      catch (err) {
        console.error('[SSE] Failed to parse notification event:', err)
      }
    })

    // 心跳 — 仅用于确认连接存活
    this.eventSource.addEventListener('heartbeat', () => {
      // no-op: 收到即表示连接正常
    })

    // 连接建立
    this.eventSource.addEventListener('connected', (e) => {
      console.info('[SSE] Connected:', e.data)
    })

    // 错误处理
    this.eventSource.onerror = () => {
      console.warn('[SSE] Connection error, will reconnect...')
      this.cleanupConnection()
      if (!this.intentionallyClosed) {
        this.scheduleReconnect()
      }
    }
  }

  /**
   * 断开 SSE 连接
   */
  disconnect() {
    this.intentionallyClosed = true
    this.cancelReconnect()
    this.cleanupConnection()
  }

  /**
   * 订阅事件
   * @returns 取消订阅的函数
   */
  on(event: 'generation_status', handler: GenerationStatusHandler): () => void
  on(event: 'notification', handler: NotificationHandler): () => void
  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set())
    }
    this.handlers.get(event)!.add(handler)
    return () => {
      this.handlers.get(event)?.delete(handler)
    }
  }

  /**
   * 重新连接（如 token 更新后）
   */
  reconnect() {
    this.disconnect()
    this.connect()
  }

  // ===== 私有方法 =====

  private emit(event: string, data: unknown) {
    const handlers = this.handlers.get(event)
    if (!handlers) return
    for (const handler of handlers) {
      try {
        ;(handler as (data: unknown) => void)(data)
      }
      catch (err) {
        console.error(`[SSE] Handler error for event "${event}":`, err)
      }
    }
  }

  private cleanupConnection() {
    if (this.eventSource) {
      this.eventSource.close()
      this.eventSource = null
    }
  }

  private scheduleReconnect() {
    this.cancelReconnect()
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, 3000)
  }

  private cancelReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }
}

/** SSE 客户端单例 */
export const sseClient = new SSEClient()
