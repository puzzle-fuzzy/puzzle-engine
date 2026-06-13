/**
 * 统一任务 handler dispatch — 基于 task.type 分发到具体 handler
 *
 * P0-2 只建立骨架，各 handler 在 P0-3 中实现。
 * 目前如果 claim 到的 task 没有对应 handler，会标记为 failed 并记录错误。
 */

import type { TaskErrorInfo, TaskRow } from '@excuse/db'
import { markTaskFailed } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('task-handler')

/**
 * 处理已 claim 的 task — 根据 task.type dispatch 到对应 handler
 *
 * handler 返回值：成功时返回 output（可选），失败时抛异常
 * 抛异常由 index.ts 的 handleTaskError 统一处理（retryable vs permanent）
 */
export async function handleTask(task: TaskRow): Promise<Record<string, unknown> | undefined> {
  logger.info({ taskId: task.id, type: task.type, domain: task.domain }, 'Handling task')

  switch (task.type) {
    // ── Canvas pipeline phases ─────────────────────────
    // P0-3 中实现：调用现有 canvas service 函数
    case 'canvas.analyze':
    case 'canvas.characters':
    case 'canvas.locations':
    case 'canvas.characterRefs':
    case 'canvas.locationRefs':
    case 'canvas.storyboard':
    case 'canvas.continuity':
    case 'canvas.rebuild':
    case 'canvas.videos':
      throw new TaskNotImplementedError(task.type)

    // ── 通用生成任务 ────────────────────────────────────
    case 'generate.text':
    case 'generate.image':
    case 'generate.video':
      throw new TaskNotImplementedError(task.type)

    // ── 字幕任务 ──────────────────────────────────────
    case 'subtitle.asr':
    case 'subtitle.export':
      throw new TaskNotImplementedError(task.type)

    // ── Gateway 任务 ──────────────────────────────────
    case 'gateway.chatCompletion':
      throw new TaskNotImplementedError(task.type)

    default:
      throw new TaskNotImplementedError(task.type)
  }
}

/**
 * Task handler 错误处理 — 区分 retriable vs permanent
 *
 * retriable 且 attempts < maxAttempts → markTaskRetrying（nextRunAt 推迟）
 * permanent 或超过 maxAttempts → markTaskFailed
 *
 * @param task 被 claim 的 task
 * @param error handler 抛出的错误
 */
export async function handleTaskError(task: TaskRow, error: unknown): Promise<void> {
  const isNotImplemented = error instanceof TaskNotImplementedError
  const retriable = !isNotImplemented && isRetriableError(error)
  const errorMessage = error instanceof Error ? error.message : String(error)

  if (isNotImplemented) {
    // 未实现的 handler → 直接标记为 failed（不应该 retry）
    const errorInfo: TaskErrorInfo = {
      category: 'validation',
      retriable: false,
      message: errorMessage,
    }
    await markTaskFailed(task.id, errorInfo, errorMessage)
    logger.warn({ taskId: task.id, type: task.type }, `Task type not implemented: ${task.type}`)
    return
  }

  if (retriable && task.attempts < task.maxAttempts) {
    // 可重试 → 计算 retry delay 并 markTaskRetrying
    const delayMs = computeRetryDelay(task.type, task.attempts)
    const nextRunAt = new Date(Date.now() + delayMs)
    const { markTaskRetrying } = await import('@excuse/db')
    await markTaskRetrying(task.id, nextRunAt)
    logger.info({ taskId: task.id, type: task.type, attempts: task.attempts, nextRetryDelay: delayMs }, 'Task retrying')
  }
  else {
    // 不可重试 或超过 maxAttempts → 永久失败
    const errorInfo: TaskErrorInfo = {
      category: categorizeError(error),
      retriable,
      code: extractErrorCode(error),
      message: errorMessage,
    }
    await markTaskFailed(task.id, errorInfo, errorMessage)
    logger.error({ taskId: task.id, type: task.type, attempts: task.attempts }, `Task permanently failed: ${errorMessage}`)
  }
}

// ── 错误分类 ────────────────────────────────────────────

/** 自定义错误：handler 未实现 */
class TaskNotImplementedError extends Error {
  constructor(taskType: string) {
    super(`Task handler not implemented: ${taskType}`)
    this.name = 'TaskNotImplementedError'
  }
}

/**
 * 判断错误是否可重试
 *
 * 参考 puzzle-bobble/apps/worker/src/retry.ts
 * - Provider timeout / throttling / internal error → retriable
 * - 连接错误 → retriable
 * - 参数校验失败 / 认证失败 → 不可重试
 * - 未知错误 → 不可重试（保守策略）
 */
function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error))
    return false

  // Provider 错误 — 根据 cause.code 分类
  const cause = error.cause as { code?: string } | undefined
  const causeCode = cause?.code

  // 网络连接错误 → retriable
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ETIMEDOUT' || causeCode === 'ECONNRESET')
    return true

  // Provider throttling / internal error → retriable
  if (causeCode === 'Throttling' || causeCode === 'InternalError' || causeCode === 'TIMEOUT')
    return true

  // 参数校验 / 认证失败 → permanent
  if (causeCode === 'InvalidParameter' || causeCode === 'AuthFailed' || causeCode === 'Forbidden')
    return false

  // 未知 → 保守策略：不重试
  return false
}

function categorizeError(error: unknown): string {
  if (error instanceof TaskNotImplementedError)
    return 'validation'
  if (!(error instanceof Error))
    return 'system'
  const cause = error.cause as { code?: string } | undefined
  if (cause?.code === 'ECONNREFUSED' || cause?.code === 'ETIMEDOUT')
    return 'timeout'
  if (cause?.code === 'Throttling' || cause?.code === 'InternalError')
    return 'provider_error'
  return 'system'
}

function extractErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error))
    return undefined
  const cause = error.cause as { code?: string } | undefined
  return cause?.code
}

/**
 * 计算 retry delay（毫秒）
 *
 * 参考 puzzle-bobble/apps/worker/src/retry.ts
 * - 视频: 60s × 2^min(attempt-1, 3) — 上限 480s
 * - 其他: 固定 30s
 */
export function computeRetryDelay(taskType: string, attempts: number): number {
  if (taskType.includes('video') || taskType === 'canvas.videos' || taskType === 'generate.video') {
    return 60_000 * 2 ** Math.min(attempts - 1, 3)
  }
  return 30_000
}
