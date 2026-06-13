/**
 * Task lock heartbeat — 定期延长 claim 锁定时间
 *
 * 参考 puzzle-bobble/apps/worker/src/index.ts 的 startLockHeartbeat()
 * Worker claim task 后启动 heartbeat，在 finally 块中停止。
 * 间隔 = max(5s, claimTtlMs/2)，确保锁不会过期。
 */

import type { TaskHeartbeatAdapter } from '@excuse/task-engine'
import { createLogger } from '@excuse/shared'
import { extendTaskLockWithAdapter } from '@excuse/task-engine'

const logger = createLogger('worker-heartbeat')

/**
 * 启动 task heartbeat — 定期延长 lockedUntil
 *
 * 续锁动作通过 adapter 注入（`extendTaskLock` 实现仍由调用方提供），
 * 让 heartbeat 的「何时续锁、续锁失败如何停止」可测试、不直接依赖 `@excuse/db`。
 *
 * @param taskId 任务 ID
 * @param workerId Worker 标识（必须与 claim 时的 lockedBy 一致）
 * @param claimTtlMs claim 锁定时长（毫秒）
 * @param adapter 续锁 adapter — 调用方注入 DB `extendTaskLock`
 * @returns stopHeartbeat 回调 — 在 finally 块中调用
 */
export function startTaskHeartbeat(
  taskId: string,
  workerId: string,
  claimTtlMs: number,
  adapter: TaskHeartbeatAdapter<unknown>,
): () => void {
  const intervalMs = Math.max(5_000, Math.floor(claimTtlMs / 2))
  let stopped = false

  const timer = setInterval(async () => {
    if (stopped)
      return
    try {
      const updated = await extendTaskLockWithAdapter({ taskId, workerId, claimTtlMs, adapter })
      if (!updated) {
        // Task 可能已被 sweep 或 cancelled — 停止 heartbeat
        logger.warn({ taskId, workerId }, 'Heartbeat: task no longer running, stopping')
        stopped = true
        clearInterval(timer)
      }
    }
    catch (err) {
      logger.error({ err, taskId, workerId }, 'Heartbeat: failed to extend lock')
    }
  }, intervalMs)

  // 返回 stop callback — 在 finally 块中调用
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
