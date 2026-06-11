import type { SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { getAuthToken } from './client'

interface SSEEventMap {
  generation_status: SSEGenerationStatusEvent
  pipeline_node_update: SSEPipelineNodeEvent
  notification: SSENotificationEvent
}

// ===== 错误类型 — 控制重连策略 =====

class RetriableError extends Error {}
class FatalError extends Error {}
class UnauthorizedError extends FatalError {}

/**
 * SSE 客户端 — 管理与服务器的实时连接
 *
 * 使用 @microsoft/fetch-event-source（基于 Fetch API）:
 *   - 支持自定义 Authorization header（JWT 不再暴露在 URL 中）
 *   - 可根据 HTTP 状态码区分重连策略
 *   - AbortController 可靠中止 fetch 流
 *   - 事件类型分发（generation_status / pipeline_node_update / notification / heartbeat）
 */
class SSEClient {
  private abortController: AbortController | null = null
  private isConnecting = false
  private handlers: { [K in keyof SSEEventMap]?: Set<(data: SSEEventMap[K]) => void> } = {}
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private intentionallyClosed = false

  /**
   * 建立 SSE 连接
   * 仅在已认证时（有 token）才连接
   */
  connect() {
    if (this.abortController || this.isConnecting)
      return

    const token = getAuthToken()
    if (!token)
      return

    this.intentionallyClosed = false
    this.isConnecting = true
    this.abortController = new AbortController()

    const baseUrl = import.meta.env.VITE_API_BASE_URL ?? ''

    fetchEventSource(`${baseUrl}/api/sse`, {
      signal: this.abortController.signal,
      headers: {
        Authorization: `Bearer ${token}`,
      },
      async onopen(response) {
        if (response.ok && response.headers.get('content-type')?.includes('text/event-stream')) {
          return
        }

        if (response.status === 401 || response.status === 403) {
          throw new UnauthorizedError('SSE authentication failed')
        }

        if (response.status >= 500) {
          throw new RetriableError(`SSE server error: ${response.status}`)
        }

        throw new FatalError(`Unexpected SSE response: ${response.status}`)
      },
      onmessage: (msg) => {
        this.handleMessage(msg.event, msg.data)
      },
      onerror: (err) => {
        if (this.intentionallyClosed)
          throw err

        if (err instanceof UnauthorizedError) {
          this.cleanupConnection()
          console.warn('[SSE] Authentication failed, stopping reconnect')
          throw err
        }

        if (err instanceof FatalError)
          throw err

        // RetriableError / 网络错误：返回重试间隔（ms）
        return 3000
      },
      onclose: () => {
        this.cleanupConnection()
        if (!this.intentionallyClosed) {
          this.scheduleReconnect()
        }
      },
      openWhenHidden: true,
    }).catch((err) => {
      this.cleanupConnection()
      if (!this.intentionallyClosed && !(err instanceof UnauthorizedError)) {
        console.warn('[SSE] Connection closed:', err)
        this.scheduleReconnect()
      }
    }).finally(() => {
      this.isConnecting = false
    })
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

  // ===== 事件解析 =====

  private handleMessage(event: string, data: string) {
    try {
      switch (event) {
        case 'generation_status':
          this.emit('generation_status', JSON.parse(data) as SSEGenerationStatusEvent)
          break
        case 'pipeline_node_update':
          this.emit('pipeline_node_update', JSON.parse(data) as SSEPipelineNodeEvent)
          break
        case 'notification':
          this.emit('notification', JSON.parse(data) as SSENotificationEvent)
          break
        case 'heartbeat':
          break
        case 'connected':
          console.info('[SSE] Connected:', data)
          break
        default:
          console.debug('[SSE] Ignored event:', event)
      }
    }
    catch (err) {
      console.error(`[SSE] Failed to parse ${event} event:`, err)
    }
  }

  // ===== 内部工具 =====

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
    if (this.abortController) {
      this.abortController.abort()
      this.abortController = null
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
