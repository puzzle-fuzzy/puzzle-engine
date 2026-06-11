import { pgClient } from './db'

/**
 * 通过 PostgreSQL NOTIFY 通知 Server 端生成状态变更
 * Worker 在更新 DB 后调用，Server 端通过 LISTEN 接收并推送到 SSE 客户端
 */
export async function notifyGenerationStatus(payload: Record<string, unknown>) {
  await pgClient.notify('generation_status', JSON.stringify(payload))
}
