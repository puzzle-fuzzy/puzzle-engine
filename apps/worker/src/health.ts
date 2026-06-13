import { createLogger } from '@excuse/shared'

const logger = createLogger('worker-health')

/** Worker 运行时状态 — 由主循环更新 */
export interface WorkerHealthState {
  isPolling: boolean
  lastPollAt: Date | null
  lastPollError: string | null
  totalTasksProcessed: number
  startedAt: Date
  /** Worker 标识 */
  workerId: string
  /** 当前正在执行的任务 ID */
  currentTaskId: string | null
  /** 通过 tasks 表 claim 的任务总数 */
  tasksClaimed: number
  /** orphan sweep 运行次数 */
  orphanSweeps: number
  /** 最近一次 sweep 时间 */
  lastSweepAt: Date | null
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
        workerId: state.workerId,
        uptime: Math.floor((Date.now() - state.startedAt.getTime()) / 1000),
        lastPollAt: state.lastPollAt?.toISOString() ?? null,
        lastPollError: state.lastPollError,
        totalTasksProcessed: state.totalTasksProcessed,
        currentTaskId: state.currentTaskId,
        tasksClaimed: state.tasksClaimed,
        orphanSweeps: state.orphanSweeps,
        lastSweepAt: state.lastSweepAt?.toISOString() ?? null,
      })
    },
  })
  logger.info({ port }, 'Worker health server listening')
  return server
}
