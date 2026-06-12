/**
 * SSE 连接管理器 + PostgreSQL LISTEN 桥接
 *
 * 核心职责：
 *   1. 维护内存中的 SSE 连接表（userId → Set<Sender>），支持多标签页
 *   2. 监听 PostgreSQL LISTEN 'generation_status' 频道
 *   3. 将 Worker 的 NOTIFY 消息解析后推送到对应用户的所有 SSE 连接
 *
 * 数据流：
 *   Worker 完成任务 → NOTIFY 'generation_status' → startSSEListener 接收
 *   → dispatchToUser → SSE route 中的 AsyncChannel → 客户端
 *
 * 两种推送事件：
 *   - generation_status: 通用生成任务状态变更
 *   - pipeline_node_update: Canvas pipeline 进度（含 canvasMeta 时自动发送）
 */
import type { GenerationNotifyPayload, SSEGenerationStatusEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { pgClient } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('sse-manager')

// ===== SSE 连接管理 =====

type Sender = (event: string, data: unknown) => void

/**
 * 按用户 ID 维护的 SSE 连接表
 * 每个用户可以有多个连接（多标签页）
 */
const connections = new Map<string, Set<Sender>>()

/**
 * 添加一个 SSE 连接
 */
export function addConnection(userId: string, send: Sender) {
  if (!connections.has(userId)) {
    connections.set(userId, new Set())
  }
  connections.get(userId)!.add(send)
  logger.debug({ userId, total: connections.get(userId)!.size }, 'SSE client connected')
}

/**
 * 移除一个 SSE 连接
 */
export function removeConnection(userId: string, send: Sender) {
  const userConns = connections.get(userId)
  if (!userConns)
    return
  userConns.delete(send)
  if (userConns.size === 0) {
    connections.delete(userId)
  }
  logger.debug({ userId, remaining: userConns.size }, 'SSE client disconnected')
}

/**
 * 向指定用户的所有连接推送事件
 */
export function dispatchToUser(userId: string, event: string, data: unknown) {
  const userConns = connections.get(userId)
  if (!userConns || userConns.size === 0)
    return

  for (const send of userConns) {
    try {
      send(event, data)
    }
    catch (err) {
      logger.error({ err, userId, event }, 'Failed to dispatch SSE event')
    }
  }
}

/**
 * 获取当前在线用户数（调试用）
 */
export function getOnlineUserCount() {
  return connections.size
}

// ===== PostgreSQL LISTEN =====

/**
 * 启动 PostgreSQL LISTEN 监听
 * 接收 Worker 通过 NOTIFY 发送的生成状态变更，推送到对应用户的 SSE 连接
 */
export async function startSSEListener() {
  await pgClient.listen('generation_status', (rawPayload) => {
    try {
      const payload: GenerationNotifyPayload = JSON.parse(rawPayload)

      const event: SSEGenerationStatusEvent = {
        id: payload.recordId,
        taskId: payload.taskId,
        traceId: payload.traceId,
        status: payload.status,
        category: payload.category,
        model: payload.model,
        ...(payload.outputResult && { outputResult: payload.outputResult }),
        ...(payload.errorMessage && { errorMessage: payload.errorMessage }),
        ...(payload.cost && { cost: payload.cost }),
      }

      dispatchToUser(payload.accountId, 'generation_status', event)
      logger.info(
        { userId: payload.accountId, recordId: payload.recordId, traceId: payload.traceId, status: payload.status },
        'SSE event dispatched',
      )

      // Canvas pipeline: dispatch pipeline_node_update for canvas-sourced records
      if (payload.canvasMeta) {
        const pipelineEvent: SSEPipelineNodeEvent = {
          projectId: payload.canvasMeta.projectId,
          nodeType: 'shot',
          nodeId: payload.canvasMeta.shotId,
          status: payload.status === 'succeeded' ? 'completed' : payload.status === 'failed' ? 'failed' : 'running',
        }
        dispatchToUser(payload.accountId, 'pipeline_node_update', pipelineEvent)
      }
    }
    catch (err) {
      logger.error({ err, rawPayload }, 'Failed to parse generation_status notification')
    }
  })

  logger.info('SSE listener started on PostgreSQL channel "generation_status"')
}
