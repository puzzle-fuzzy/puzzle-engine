import { MetricsCollector } from '@excuse/metrics'

const metrics = new MetricsCollector()

// ===== 记录方法 =====

/** 记录一次请求的延迟和状态码 */
export function recordRequest(status: number, durationMs: number) {
  metrics.recordRequest(status, durationMs)
}

/** 记录一次错误（非 HTTP 请求错误，如 SSE 断连、DB 操作失败） */
export function recordError() {
  metrics.recordError()
}

// ===== 查询方法 =====

/** 获取当前指标快照 */
export function getMetrics(onlineUsers: number, uptime: number) {
  return metrics.snapshot(onlineUsers, uptime)
}

/** 重置所有指标（测试用） */
export function resetMetrics() {
  metrics.reset()
}
