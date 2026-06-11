import type { SSEGenerationStatusEvent, SSENotificationEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { fetchEventSource } from '@microsoft/fetch-event-source'
import { parseSSEGenerationStatusEvent, parseSSENotificationEvent, parseSSEPipelineNodeEvent } from '@excuse/shared'
import { getAuthToken } from './client'

/**
 * SSE 事件类型映射 — 服务器推送的事件名与 payload 结构
 *
 * - generation_status: 生成任务状态变更（pending → processing → succeeded/failed）
 * - pipeline_node_update: Canvas pipeline 各节点进度更新
 * - notification: 系统通知（余额预警、任务完成等）
 */
interface SSEEventMap {
  generation_status: SSEGenerationStatusEvent
  pipeline_node_update: SSEPipelineNodeEvent
  notification: SSENotificationEvent
}

// ===== 错误类型 — 控制重连策略 =====
// fetch-event-source 通过 onopen 抛出的错误类型决定是否重连：
//   - RetriableError: onerror 返回延迟值后自动重试（5xx、网络中断）
//   - FatalError: 不重连，连接终止（4xx 非 401/403）
//   - UnauthorizedError: 401/403，停止重连并清理登录态

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
  /** 用户主动调用 disconnect() 时为 true，此时不触发自动重连 */
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
      openWhenHidden: true, // 保持后台 tab 连接不断开，确保 Canvas 页面切走后仍能收到 pipeline 更新
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
    let set = this.handlers[event] as Set<(data: SSEEventMap[K]) => void> | undefined
    if (!set) {
      set = new Set<(data: SSEEventMap[K]) => void>()
      ;(this.handlers as Record<string, unknown>)[event] = set
    }
    set.add(handler)
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
    let parsed: unknown
    try {
      parsed = JSON.parse(data)
    }
    catch {
      console.error(`[SSE] Invalid JSON for ${event} event`)
      return
    }

    switch (event) {
      case 'generation_status': {
        const evt = parseSSEGenerationStatusEvent(parsed)
        if (evt)
          this.emit('generation_status', evt)
        else
          console.warn('[SSE] Discarded malformed generation_status event:', parsed)
        break
      }
      case 'pipeline_node_update': {
        const evt = parseSSEPipelineNodeEvent(parsed)
        if (evt)
          this.emit('pipeline_node_update', evt)
        else
          console.warn('[SSE] Discarded malformed pipeline_node_update event:', parsed)
        break
      }
      case 'notification': {
        const evt = parseSSENotificationEvent(parsed)
        if (evt)
          this.emit('notification', evt)
        else
          console.warn('[SSE] Discarded malformed notification event:', parsed)
        break
      }
      case 'heartbeat':
        // 服务端 30s 心跳，无需业务处理；连接本身保活由 fetch-event-source 管理
        break
      case 'connected':
        console.info('[SSE] Connected:', data)
        break
      default:
        console.debug('[SSE] Ignored event:', event)
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
