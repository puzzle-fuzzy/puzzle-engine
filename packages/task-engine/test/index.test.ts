import { describe, expect, it } from 'bun:test'
import {
  classifyTaskError,
  computeRetryDelay,
  shouldRetryTask,
  TaskNotImplementedError,
} from '../src'

describe('@excuse/task-engine', () => {
  it('classifies unimplemented tasks as validation and non-retriable', () => {
    const decision = classifyTaskError(new TaskNotImplementedError('generate.video'))

    expect(decision).toEqual({
      category: 'validation',
      retriable: false,
      message: 'Task handler not implemented: generate.video',
    })
  })

  it('marks provider transient errors as retriable', () => {
    const error = new Error('provider throttled', { cause: { code: 'Throttling' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'provider_error',
      retriable: true,
      code: 'Throttling',
      message: 'provider throttled',
    })
  })

  it('marks invalid parameter errors as non-retriable system errors', () => {
    const error = new Error('bad request', { cause: { code: 'InvalidParameter' } })

    expect(classifyTaskError(error)).toEqual({
      category: 'system',
      retriable: false,
      code: 'InvalidParameter',
      message: 'bad request',
    })
  })

  it('checks retry budget', () => {
    const error = new Error('timeout', { cause: { code: 'ETIMEDOUT' } })

    expect(shouldRetryTask(error, 1, 3)).toBe(true)
    expect(shouldRetryTask(error, 3, 3)).toBe(false)
  })

  it('uses longer exponential delay for video tasks', () => {
    expect(computeRetryDelay('canvas.videos', 1)).toBe(60_000)
    expect(computeRetryDelay('generate.video', 3)).toBe(240_000)
    expect(computeRetryDelay('canvas.analyze', 3)).toBe(30_000)
  })
})
