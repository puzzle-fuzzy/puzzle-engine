import type { CostDetail, GenerationCategory, GenerationStatus, OutputResult } from '@excuse/db'
import type { SSEPipelineNodeEvent } from './canvas'
import { parseCostDetail, parseOutputResult } from './generation'

// ===== SSE 事件类型定义 =====

/**
 * Worker → PostgreSQL NOTIFY 的负载
 * Worker 在更新 DB 后通过 pgClient.notify() 发送
 */
export interface GenerationNotifyPayload {
  accountId: string
  recordId: string
  status: GenerationStatus
  category: GenerationCategory
  model: string
  taskId: string
  traceId?: string | null
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
  /** Canvas pipeline metadata (present when source === 'canvas') */
  canvasMeta?: {
    projectId: string
    shotId: string
  }
}

/**
 * SSE 推送到前端的生成状态事件
 * 当 Worker 完成任务（成功/失败）时推送
 */
export interface SSEGenerationStatusEvent {
  id: string
  taskId: string
  traceId?: string | null
  status: GenerationStatus
  category: GenerationCategory
  model: string
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
}

/**
 * SSE 通知事件 — 新通知推送
 */
export interface SSENotificationEvent {
  id: string
  type: string
  title: string
  body?: string
  read: boolean
  createdAt: string
}

/** SSE 连接建立事件 */
export interface SSEConnectedEvent {
  timestamp: string
}

/** SSE 心跳事件 */
export interface SSEHeartbeatEvent {
  timestamp: string
}

// ===== SSE 事件解析器 — 边界层运行时校验 =====
// SSE payload 来自网络（JSON 文本），必须在分发前解析为类型安全结构。
// 解析失败返回 null，调用方丢弃事件并记录日志，不抛异常不崩溃连接。

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function str(o: Record<string, unknown>, key: string): string | undefined {
  const v = o[key]
  return typeof v === 'string' ? v : undefined
}

const VALID_STATUSES: readonly string[] = ['pending', 'submitting', 'processing', 'saving_output', 'succeeded', 'failed', 'cancelled']
const VALID_CATEGORIES: readonly string[] = ['text', 'image', 'video']

/**
 * 解析 generation_status 事件
 *
 * 服务端从 GenerationNotifyPayload 映射而来，字段包括
 * id, taskId, status, category, model + 可选 outputResult / cost / errorMessage
 */
export function parseSSEGenerationStatusEvent(raw: unknown): SSEGenerationStatusEvent | null {
  if (!isObject(raw))
    return null
  const id = str(raw, 'id')
  const taskId = str(raw, 'taskId')
  const model = str(raw, 'model')
  const status = str(raw, 'status')
  const category = str(raw, 'category')
  if (!id || !taskId || !model || !status || !category)
    return null
  if (!VALID_STATUSES.includes(status))
    return null
  if (!VALID_CATEGORIES.includes(category))
    return null

  const outputResult = parseOutputResult(raw.outputResult)
  const cost = parseCostDetail(raw.cost)

  return {
    id,
    taskId,
    status: status as GenerationStatus,
    category: category as GenerationCategory,
    model,
    ...(outputResult && { outputResult }),
    ...(typeof raw.errorMessage === 'string' && { errorMessage: raw.errorMessage }),
    ...(cost && { cost }),
  }
}

/**
 * 解析 pipeline_node_update 事件
 *
 * Canvas pipeline 各阶段进度，字段包括
 * projectId, nodeType, nodeId, status + 可选 data / error
 */
export function parseSSEPipelineNodeEvent(raw: unknown): SSEPipelineNodeEvent | null {
  if (!isObject(raw))
    return null
  const projectId = str(raw, 'projectId')
  const nodeType = str(raw, 'nodeType')
  const nodeId = str(raw, 'nodeId')
  const status = str(raw, 'status')
  if (!projectId || !nodeType || !nodeId || !status)
    return null
  if (!['running', 'completed', 'failed'].includes(status))
    return null

  return {
    projectId,
    nodeType,
    nodeId,
    status: status as SSEPipelineNodeEvent['status'],
    ...(typeof raw.runId === 'string' && { runId: raw.runId }),
    ...(raw.data != null && typeof raw.data === 'object' && { data: raw.data as Record<string, unknown> }),
    ...(typeof raw.error === 'string' && { error: raw.error }),
  }
}

/**
 * 解析 notification 事件
 *
 * 预留通知接口，字段包括 id, type, title, body, createdAt
 */
export function parseSSENotificationEvent(raw: unknown): SSENotificationEvent | null {
  if (!isObject(raw))
    return null
  const id = str(raw, 'id')
  const type = str(raw, 'type')
  const title = str(raw, 'title')
  const body = str(raw, 'body')
  const createdAt = str(raw, 'createdAt')
  if (!id || !type || !title || !body || !createdAt)
    return null

  return { id, type, title, body, read: false, createdAt }
}
