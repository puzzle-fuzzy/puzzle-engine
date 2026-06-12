import type { TaskResult } from './task-processor'
import type { WorkerHealthState } from './health'
import { pollPendingVideoTasks } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { loadConfig } from './config'
import { createHealthServer } from './health'
import { createTaskProcessor } from './task-processor'

const config = loadConfig()
const processor = createTaskProcessor(config)
const logger = createLogger('worker')

/**
 * 轮询循环控制状态
 *
 * running: SIGINT/SIGTERM 时置 false，循环在下一轮检查后退出
 * currentTaskPromise: 当前正在处理的任务，用于优雅退出时等待其完成
 */
let running = true
let currentTaskPromise: Promise<TaskResult> | null = null

/** 优雅退出最大等待时间 — 超过此时间强制退出，避免长时间挂起 */
const GRACEFUL_TIMEOUT_MS = 30_000

// ── Worker 健康状态 ──────────────────────────────────────

const healthState: WorkerHealthState = {
  isPolling: false,
  lastPollAt: null,
  lastPollError: null,
  totalTasksProcessed: 0,
  startedAt: new Date(),
}

const healthPort = Number(process.env.WORKER_HEALTH_PORT) || 5100
createHealthServer(healthState, healthPort)

// ── 优雅退出 ──────────────────────────────────────────
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    logger.info({ signal }, '🛑 Received signal, shutting down gracefully...')
    running = false

    // Wait for current task to finish (max 30s), then force exit
    if (currentTaskPromise) {
      const timeout = setTimeout(() => {
        logger.warn('⏰ Graceful timeout exceeded, forcing exit')
        process.exit(1)
      }, GRACEFUL_TIMEOUT_MS)

      try {
        await currentTaskPromise
        logger.info('✅ Current task completed before exit')
      }
      catch {
        logger.warn('⚠️ Current task failed during graceful shutdown')
      }
      clearTimeout(timeout)
    }

    process.exit(0)
  })
}

// ── 轮询循环 ──────────────────────────────────────────
/**
 * Worker 主循环 — 持续轮询 DB 中 pending 的视频任务并处理
 *
 * 流程: pollPendingVideoTasks() → processor.processTask() → 根据 action 结果处理
 * 退出: SIGINT/SIGTERM → running=false → 当前任务完成后退出（最长 30s）
 *
 * 恢复策略:
 *   - ECONNREFUSED: DB 不可用时立即停止 worker（需人工检查 DB 服务）
 *   - 其他错误: 记录日志后继续下一轮轮询
 *   - 半完成状态: pollPendingVideoTasks 会重新捞取 processing 但 provider 已返回结果的任务
 */
async function main() {
  logger.info({ pollIntervalMs: config.pollIntervalMs, healthPort }, '🤖 Worker started')

  while (running) {
    healthState.isPolling = true
    try {
      const records = await pollPendingVideoTasks()
      healthState.lastPollAt = new Date()
      healthState.lastPollError = null

      for (const record of records) {
        if (!running)
          break // 退出信号检查

        const taskLogger = logger.child({ taskId: record.taskId, traceId: record.traceId })
        currentTaskPromise = processor.processTask(record)

        const result = await currentTaskPromise
        currentTaskPromise = null

        if (result.action === 'completed') {
          healthState.totalTasksProcessed++
        }

        // result.action 含义:
        //   completed — 任务成功完成，结果已写入 DB
        //   skipped — 记录无 taskId 或已被其他 worker 处理，跳过
        //   ignored — provider 返回未识别状态，记录警告
        switch (result.action) {
          case 'completed':
            taskLogger.info('✅ Task completed')
            break
          case 'skipped':
            if (result.reason === 'no taskId') {
              taskLogger.info({ recordId: record.id, reason: result.reason }, '⏭️ Record skipped')
            }
            break
          case 'ignored':
            taskLogger.warn({ status: result.status }, '⚠️ Unknown task status')
            break
        }
      }
    }
    catch (error: unknown) {
      const err = error instanceof Error ? error : null
      const code = (err?.cause as { code?: string } | undefined)?.code
        ?? (err as NodeJS.ErrnoException)?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
        healthState.lastPollError = 'ECONNREFUSED'
        running = false
        break
      }
      healthState.lastPollError = err?.message ?? String(error)
      logger.error({ err: error }, 'Worker poll error')
    }
    healthState.isPolling = false

    // 分段 sleep，以便更快响应退出信号
    const sleepMs = config.pollIntervalMs
    const checkInterval = 1000
    let remaining = sleepMs
    while (remaining > 0 && running) {
      const step = Math.min(remaining, checkInterval)
      await Bun.sleep(step)
      remaining -= step
    }
  }

  logger.info('🤖 Worker stopped.')
}

main()
