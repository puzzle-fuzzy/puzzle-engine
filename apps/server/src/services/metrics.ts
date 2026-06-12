/**
 * 轻量级内存指标收集器
 *
 * 收集请求数、延迟分布、任务状态、SSE 连接数、错误率。
 * 数据存在内存中，进程重启后清零。
 * 适合单实例部署；多实例部署时需外部聚合（Prometheus 等）。
 */

interface MetricsSnapshot {
  requests: {
    total: number
    byStatus: Record<number, number>
  }
  latency: {
    p50: number
    p95: number
    p99: number
    avgMs: number
  }
  sse: {
    onlineUsers: number
  }
  generation: {
    byStatus: Record<string, number>
  }
  errors: number
  uptime: number
}

/** 滑动窗口延迟采样（保留最近 1000 条） */
const LATENCY_WINDOW_SIZE = 1000
const latencyWindow: number[] = []
let latencySum = 0

/** 请求计数器 */
let totalRequests = 0
const statusCounts = new Map<number, number>()

/** 错误计数 */
let errorCount = 0

// ===== 记录方法 =====

/** 记录一次请求的延迟和状态码 */
export function recordRequest(status: number, durationMs: number) {
  totalRequests++

  const current = statusCounts.get(status) ?? 0
  statusCounts.set(status, current + 1)

  // 滑动窗口
  latencyWindow.push(durationMs)
  latencySum += durationMs
  if (latencyWindow.length > LATENCY_WINDOW_SIZE) {
    const removed = latencyWindow.shift()!
    latencySum -= removed
  }

  if (status >= 500) {
    errorCount++
  }
}

/** 记录一次错误（非 HTTP 请求错误，如 SSE 断连、DB 操作失败） */
export function recordError() {
  errorCount++
}

// ===== 查询方法 =====

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0)
    return 0
  const idx = Math.ceil((p / 100) * sorted.length) - 1
  return sorted[Math.max(0, idx)]!
}

/** 获取当前指标快照 */
export function getMetrics(onlineUsers: number, uptime: number): MetricsSnapshot {
  const sorted = [...latencyWindow].sort((a, b) => a - b)

  const byStatus: Record<number, number> = {}
  for (const [code, count] of statusCounts) {
    byStatus[code] = count
  }

  return {
    requests: {
      total: totalRequests,
      byStatus,
    },
    latency: {
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      p99: percentile(sorted, 99),
      avgMs: latencyWindow.length > 0 ? Math.round(latencySum / latencyWindow.length) : 0,
    },
    sse: {
      onlineUsers,
    },
    generation: {
      byStatus: {},
    },
    errors: errorCount,
    uptime,
  }
}

/** 重置所有指标（测试用） */
export function resetMetrics() {
  totalRequests = 0
  statusCounts.clear()
  errorCount = 0
  latencyWindow.length = 0
  latencySum = 0
}
