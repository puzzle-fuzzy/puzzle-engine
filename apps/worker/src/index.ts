import { pollPendingVideoTasks } from '@excuse/db'
import { loadConfig } from './config'
import { createTaskProcessor } from './task-processor'

const config = loadConfig()
const processor = createTaskProcessor(config)

let running = true

// ── 优雅退出 ──────────────────────────────────────────
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    console.log(`\n🛑 Received ${signal}, shutting down...`)
    running = false
  })
}

// ── 轮询循环 ──────────────────────────────────────────
async function main() {
  console.log('🤖 Worker started, polling interval:', config.pollIntervalMs, 'ms')

  while (running) {
    try {
      const records = await pollPendingVideoTasks()

      for (const record of records) {
        if (!running) break // 退出信号检查

        const result = await processor.processTask(record)
        const taskId = 'taskId' in result ? result.taskId : record.taskId

        switch (result.action) {
          case 'completed':
            console.log(`✅ Task ${taskId} completed`)
            break
          case 'skipped':
            // 超时或仍在处理中，不需要每次打印
            if (result.reason === 'no taskId') {
              console.log(`⏭️ Record ${record.id} skipped: ${result.reason}`)
            }
            break
          case 'ignored':
            console.log(`⚠️ Task ${taskId} unknown status: ${result.status}`)
            break
        }
      }
    }
    catch (error) {
      console.error('Worker poll error:', error)
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

  console.log('🤖 Worker stopped.')
}

main()
