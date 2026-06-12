import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-health')

/** Worker 运行时状态 — 由主循环更新 */
export interface WorkerHealthState {
  isPolling: boolean
  lastPollAt: Date | null
  lastPollError: string | null
  totalTasksProcessed: number
  startedAt: Date
}

/**
 * 启动轻量级 HTTP 健康检查服务
 * 返回 JSON 格式的 worker 运行状态
 */
export function createHealthServer(state: WorkerHealthState, port: number) {
  const server = Bun.serve({
    port,
    fetch(req) {
      if (req.method !== 'GET' || new URL(req.url).pathname !== '/health') {
        return new Response('Not Found', { status: 404 })
      }
      return Response.json({
        status: state.isPolling ? 'polling' : 'idle',
        uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
        lastPollAt: state.lastPollAt?.toISOString() ?? null,
        lastPollError: state.lastPollError,
        totalTasksProcessed: state.totalTasksProcessed,
      })
    },
  })
  logger.info({ port }, 'Worker health server listening')
  return server
}
