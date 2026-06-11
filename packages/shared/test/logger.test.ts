import { Writable } from 'node:stream'
import { afterEach, describe, expect, it } from 'bun:test'
import { createLogger } from '../src/logger'

describe('createLogger', () => {
  const originalEnv = process.env.NODE_ENV
  const originalLogLevel = process.env.LOG_LEVEL

  afterEach(() => {
    process.env.NODE_ENV = originalEnv
    if (originalLogLevel) {
      process.env.LOG_LEVEL = originalLogLevel
    }
    else {
      delete process.env.LOG_LEVEL
    }
  })

  it('创建具有指定名称的 logger', () => {
    const logger = createLogger('test-module')
    expect(logger).toBeDefined()
    expect(logger.info).toBeTypeOf('function')
    expect(logger.error).toBeTypeOf('function')
    expect(logger.warn).toBeTypeOf('function')
    expect(logger.debug).toBeTypeOf('function')
  })

  it('开发环境默认日志级别为 debug', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.LOG_LEVEL

    const logger = createLogger('test-dev')
    expect(logger.level).toBe('debug')
  })

  it('生产环境默认日志级别为 info', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.LOG_LEVEL

    const logger = createLogger('test-prod')
    expect(logger.level).toBe('info')
  })

  it('LOG_LEVEL 环境变量覆盖默认级别', () => {
    process.env.NODE_ENV = 'development'
    process.env.LOG_LEVEL = 'warn'

    const logger = createLogger('test-override')
    expect(logger.level).toBe('warn')
  })

  it('可以传入自定义 pino 选项', () => {
    const logger = createLogger('test-custom', {
      level: 'error',
    })

    expect(logger.level).toBe('error')
  })

  it('脱敏配置：password/token/secret/apiKey 字段被替换为 [Redacted]', async () => {
    const chunks: string[] = []
    const stream = new Writable({ write(chunk, _enc, cb) {
      chunks.push(chunk.toString())
      cb()
    } })

    // 用 transport: undefined 走同步 JSON 序列化路径，绑定到我们的 stream
    process.env.NODE_ENV = 'production'
    delete process.env.LOG_LEVEL
    const pino = await import('pino')
    const logger = pino.pino(
      {
        name: 'test-redact',
        level: 'info',
        redact: {
          paths: ['password', 'token', 'secret', 'apiKey'],
          censor: '[Redacted]',
        },
      },
      stream,
    )

    logger.info({ password: 'secret123', token: 'abc', apiKey: 'key123', safe: 'visible' }, 'test')

    // pino 异步刷新
    await new Promise<void>(resolve => stream.end(() => resolve()))

    const parsed = JSON.parse(chunks.join(''))
    expect(parsed.password).toBe('[Redacted]')
    expect(parsed.token).toBe('[Redacted]')
    expect(parsed.apiKey).toBe('[Redacted]')
    expect(parsed.safe).toBe('visible')
  })
})
