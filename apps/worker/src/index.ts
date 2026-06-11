import { pollPendingVideoTasks } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { loadConfig } from './config'
import { createTaskProcessor } from './task-processor'

const config = loadConfig()
const processor = createTaskProcessor(config)
const logger = createLogger('worker')

let running = true

// ── 优雅退出 ──────────────────────────────────────────
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info({ signal }, '🛑 Received signal, shutting down...')
    running = false
  })
}

// ── 轮询循环 ──────────────────────────────────────────
async function main() {
  logger.info({ pollIntervalMs: config.pollIntervalMs }, '🤖 Worker started')

  while (running) {
    try {
      const records = await pollPendingVideoTasks()

      for (const record of records) {
        if (!running)
          break // 退出信号检查

        const taskLogger = logger.child({ taskId: record.taskId })
        const result = await processor.processTask(record)

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
    catch (error: any) {
      const code = error?.cause?.code || error?.code
      if (code === 'ECONNREFUSED') {
        logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
        running = false
        break
      }
      logger.error({ err: error }, 'Worker poll error')
    }

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
