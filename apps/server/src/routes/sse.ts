import type { ServerConfig } from '../config'
import { Elysia, sse, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { addConnection, removeConnection } from '../services/sse-manager'

// ===== Push → Pull 适配器 =====
// Elysia 的 sse() 使用 generator（pull 模式），
// 但我们的消息来自 PostgreSQL LISTEN（push 模式）。
// AsyncChannel 通过 Promise 队列桥接两者。

interface SSEMessage {
  event: string
  data: unknown
}

function createAsyncChannel() {
  let resolver: ((value: SSEMessage) => void) | null = null
  const queue: SSEMessage[] = []

  return {
    push(item: SSEMessage) {
      if (resolver) {
        resolver(item)
        resolver = null
      }
      else {
        queue.push(item)
      }
    },
    async next(): Promise<SSEMessage> {
      if (queue.length > 0)
        return queue.shift()!
      return new Promise<SSEMessage>((resolve) => {
        resolver = resolve
      })
    },
  }
}

// ===== SSE 路由 =====

/**
 * SSE 端点 — 实时推送生成状态和通知
 *
 * 客户端通过 fetchEventSource 连接: GET /api/sse
 * 认证方式: Authorization: Bearer <jwt>（唯一认证方式）
 * Query token 已移除 — JWT 不再暴露在 URL 中（避免日志泄露风险）
 * 支持的事件类型:
 *   - connected: 连接建立
 *   - heartbeat: 心跳保活（30 秒间隔）
 *   - generation_status: 生成任务状态变更
 *   - pipeline_node_update: Canvas pipeline 进度
 *   - notification: 通知（预留）
 */
export function createSSERoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api' })
    .use(createAuthPlugin(config))
    .get('/sse', async function* ({ userId }) {
      // 未认证时直接返回（generator 无 yield 时 Elysia 自动转普通响应）
      if (!userId)
        return

      const channel = createAsyncChannel()
      const sender = (event: string, data: unknown) => {
        channel.push({ event, data })
      }

      addConnection(userId, sender)

      try {
        // 连接建立事件
        yield sse({
          event: 'connected',
          data: { timestamp: new Date().toISOString() },
        })

        // 心跳保活 — 防止空闲连接被中间代理或 Bun 关闭
        const heartbeat = setInterval(() => {
          channel.push({
            event: 'heartbeat',
            data: { timestamp: new Date().toISOString() },
          })
        }, 30_000)

        try {
          // 持续等待并推送消息
          while (true) {
            const msg = await channel.next()
            yield sse({ event: msg.event, data: msg.data })
          }
        }
        finally {
          clearInterval(heartbeat)
        }
      }
      finally {
        removeConnection(userId, sender)
      }
    }, {
      // SSE 只通过 Authorization header 认证，不再支持 query token
    })
}
