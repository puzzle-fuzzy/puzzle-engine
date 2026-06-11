import type { SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { getAuthToken } from './client'

interface SSEEventMap {
  generation_status: SSEGenerationStatusEvent
  pipeline_node_update: SSEPipelineNodeEvent
  notification: SSENotificationEvent
}

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
  private handlers: { [K in keyof SSEEventMap]?: Set<(data: SSEEventMap[K]) => void> } = {}
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false

  /**
   * 建立 SSE 连接
   * 仅在已认证时（有 token）才连接
   */
  connect() {
    if (this.eventSource)
      return

    const token = getAuthToken()
    if (!token)
      return

    this.intentionallyClosed = false
    this.eventSource = new EventSource(`/api/sse?token=${encodeURIComponent(token)}`)

    this.eventSource.addEventListener('generation_status', (e) => {
      try {
        const data = JSON.parse(e.data) as SSEGenerationStatusEvent
        this.emit('generation_status', data)
      }
      catch (err) {
        console.error('[SSE] Failed to parse generation_status event:', err)
      }
    })

    this.eventSource.addEventListener('pipeline_node_update', (e) => {
      try {
        const data = JSON.parse(e.data) as SSEPipelineNodeEvent
        this.emit('pipeline_node_update', data)
      }
      catch (err) {
        console.error('[SSE] Failed to parse pipeline_node_update event:', err)
      }
    })

    this.eventSource.addEventListener('notification', (e) => {
      try {
        const data = JSON.parse(e.data) as SSENotificationEvent
        this.emit('notification', data)
      }
      catch (err) {
        console.error('[SSE] Failed to parse notification event:', err)
      }
    })

    this.eventSource.addEventListener('heartbeat', () => {
      // no-op: 收到即表示连接正常
    })

    this.eventSource.addEventListener('connected', (e) => {
      console.info('[SSE] Connected:', e.data)
    })

    this.eventSource.onerror = () => {
      console.warn('[SSE] Connection error, will reconnect...')
      this.cleanupConnection()
      if (!this.intentionallyClosed) {
        this.scheduleReconnect()
      }
    }
  }

  disconnect() {
    this.intentionallyClosed = true
    this.cancelReconnect()
    this.cleanupConnection()
  }

  /**
   * 订阅事件 — 完全类型安全
   * event 名称决定 handler 的参数类型
   * @returns 取消订阅的函数
   */
  on<K extends keyof SSEEventMap>(event: K, handler: (data: SSEEventMap[K]) => void): () => void {
    const set = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
    if (!set) {
      const newSet = new Set<(data: SSEEventMap[K]) => void>()
      this.handlers[event] = newSet as any
      newSet.add(handler)
    }
    else {
      set.add(handler)
    }
    return () => {
      const existing = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
      existing?.delete(handler)
    }
  }

  reconnect() {
    this.disconnect()
    this.connect()
  }

  private emit<K extends keyof SSEEventMap>(event: K, data: SSEEventMap[K]) {
    const set = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
    if (!set)
      return
    for (const handler of set) {
      try {
        handler(data)
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
