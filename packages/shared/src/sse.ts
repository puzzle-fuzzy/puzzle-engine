import type { CostDetail, GenerationCategory, GenerationStatus, OutputResult } from '@excuse/db'

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
  status: GenerationStatus
  category: GenerationCategory
  model: string
  outputResult?: OutputResult
  errorMessage?: string
  cost?: CostDetail
}

/**
 * 预留：通知事件
 * 后续通知功能可通过此事件类型推送
 */
export interface SSENotificationEvent {
  id: string
  type: string
  title: string
  body: string
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
