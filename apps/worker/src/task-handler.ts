/**
 * 统一任务 handler dispatch — 基于 task.type 分发到具体 handler
 *
 * Canvas phase handlers 在 P0-3 中已实现（canvas-handlers.ts）。
 * 其他类型暂抛 TaskNotImplementedError。
 */

import type { TaskErrorInfo, TaskRow } from '@excuse/db'
import type { WorkerConfig } from './config'
import { markTaskFailed } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { markRunFailedAndNotify } from './canvas-handlers'

const logger = createLogger('task-handler')

/**
 * 处理已 claim 的 task — 根据 task.type dispatch 到对应 handler
 *
 * handler 返回值：成功时返回 output（可选），失败时抛异常
 * 抛异常由 index.ts 的 handleTaskError 统一处理（retryable vs permanent）
 */
export async function handleTask(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown> | undefined> {
  logger.info({ taskId: task.id, type: task.type, domain: task.domain }, 'Handling task')

  switch (task.type) {
    // ── Canvas pipeline phases ─────────────────────────
    // Delegated to canvas-handlers.ts — dynamic import of server service functions
    case 'canvas.analyze': {
      const { handleCanvasAnalyze } = await import('./canvas-handlers')
      return handleCanvasAnalyze(task, workerConfig)
    }
    case 'canvas.characters': {
      const { handleCanvasCharacters } = await import('./canvas-handlers')
      return handleCanvasCharacters(task, workerConfig)
    }
    case 'canvas.locations': {
      const { handleCanvasLocations } = await import('./canvas-handlers')
      return handleCanvasLocations(task, workerConfig)
    }
    case 'canvas.characterRefs': {
      const { handleCanvasCharacterRefs } = await import('./canvas-handlers')
      return handleCanvasCharacterRefs(task, workerConfig)
    }
    case 'canvas.locationRefs': {
      const { handleCanvasLocationRefs } = await import('./canvas-handlers')
      return handleCanvasLocationRefs(task, workerConfig)
    }
    case 'canvas.storyboard': {
      const { handleCanvasStoryboard } = await import('./canvas-handlers')
      return handleCanvasStoryboard(task, workerConfig)
    }
    case 'canvas.continuity': {
      const { handleCanvasContinuity } = await import('./canvas-handlers')
      return handleCanvasContinuity(task, workerConfig)
    }
    case 'canvas.rebuild': {
      const { handleCanvasRebuild } = await import('./canvas-handlers')
      return handleCanvasRebuild(task, workerConfig)
    }
    case 'canvas.videos': {
      const { handleCanvasVideos } = await import('./canvas-handlers')
      return handleCanvasVideos(task, workerConfig)
    }

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
 * Canvas domain: additionally markRunFailedAndNotify (pipeline run + PG NOTIFY)
 */
export async function handleTaskError(task: TaskRow, error: unknown): Promise<void> {
  const isNotImplemented = error instanceof TaskNotImplementedError
  const retriable = !isNotImplemented && isRetriableError(error)
  const errorMessage = error instanceof Error ? error.message : String(error)

  if (isNotImplemented) {
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
    const delayMs = computeRetryDelay(task.type, task.attempts)
    const nextRunAt = new Date(Date.now() + delayMs)
    const { markTaskRetrying } = await import('@excuse/db')
    await markTaskRetrying(task.id, nextRunAt)
    logger.info({ taskId: task.id, type: task.type, attempts: task.attempts, nextRetryDelay: delayMs }, 'Task retrying')
  }
  else {
    const errorInfo: TaskErrorInfo = {
      category: categorizeError(error),
      retriable,
      code: extractErrorCode(error),
      message: errorMessage,
    }
    await markTaskFailed(task.id, errorInfo, errorMessage)
    logger.error({ taskId: task.id, type: task.type, attempts: task.attempts }, `Task permanently failed: ${errorMessage}`)

    // Canvas 任务额外标记 pipeline run 为 failed + PG NOTIFY
    if (task.domain === 'canvas' && task.projectId) {
      await markRunFailedAndNotify(task, errorMessage)
    }
  }
}

// ── 错误分类 ────────────────────────────────────────────

class TaskNotImplementedError extends Error {
  constructor(taskType: string) {
    super(`Task handler not implemented: ${taskType}`)
    this.name = 'TaskNotImplementedError'
  }
}

function isRetriableError(error: unknown): boolean {
  if (!(error instanceof Error))
    return false
  const cause = error.cause as { code?: string } | undefined
  const causeCode = cause?.code
  if (causeCode === 'ECONNREFUSED' || causeCode === 'ETIMEDOUT' || causeCode === 'ECONNRESET')
    return true
  if (causeCode === 'Throttling' || causeCode === 'InternalError' || causeCode === 'TIMEOUT')
    return true
  if (causeCode === 'InvalidParameter' || causeCode === 'AuthFailed' || causeCode === 'Forbidden')
    return false
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

export function computeRetryDelay(taskType: string, attempts: number): number {
  if (taskType.includes('video') || taskType === 'canvas.videos' || taskType === 'generate.video') {
    return 60_000 * 2 ** Math.min(attempts - 1, 3)
  }
  return 30_000
}
