export type TaskErrorCategory = 'provider_error' | 'timeout' | 'validation' | 'system'

export interface TaskErrorDecision {
  category: TaskErrorCategory
  retriable: boolean
  code?: string
  message: string
}

export class TaskNotImplementedError extends Error {
  constructor(taskType: string) {
    super(`Task handler not implemented: ${taskType}`)
    this.name = 'TaskNotImplementedError'
  }
}

export function classifyTaskError(error: unknown): TaskErrorDecision {
  const message = error instanceof Error ? error.message : String(error)

  if (error instanceof TaskNotImplementedError) {
    return {
      category: 'validation',
      retriable: false,
      message,
    }
  }

  if (!(error instanceof Error)) {
    return {
      category: 'system',
      retriable: false,
      message,
    }
  }

  const code = extractErrorCode(error)
  const retriable = isRetriableTaskErrorCode(code)
  return {
    category: categorizeTaskErrorCode(code),
    retriable,
    ...(code && { code }),
    message,
  }
}

export function shouldRetryTask(
  error: unknown,
  attempts: number,
  maxAttempts: number,
): boolean {
  return classifyTaskError(error).retriable && attempts < maxAttempts
}

export function computeRetryDelay(taskType: string, attempts: number): number {
  if (taskType.includes('video') || taskType === 'canvas.videos' || taskType === 'generate.video') {
    return 60_000 * 2 ** Math.min(attempts - 1, 3)
  }
  return 30_000
}

export function extractErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error))
    return undefined
  const cause = error.cause as { code?: string } | undefined
  return cause?.code
}

function isRetriableTaskErrorCode(code: string | undefined): boolean {
  return code === 'ECONNREFUSED'
    || code === 'ETIMEDOUT'
    || code === 'ECONNRESET'
    || code === 'Throttling'
    || code === 'InternalError'
    || code === 'TIMEOUT'
}

function categorizeTaskErrorCode(code: string | undefined): TaskErrorCategory {
  if (code === 'ECONNREFUSED' || code === 'ETIMEDOUT' || code === 'TIMEOUT')
    return 'timeout'
  if (code === 'Throttling' || code === 'InternalError' || code === 'ECONNRESET')
    return 'provider_error'
  return 'system'
}
