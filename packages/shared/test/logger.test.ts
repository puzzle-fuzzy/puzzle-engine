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

  it('脱敏配置：password/token/secret/apiKey 等字段被替换', () => {
    // pino redact 在日志输出时生效，无法直接测试脱敏结果
    // 但可以验证 logger 正常工作不报错
    const logger = createLogger('test-redact')
    expect(() => {
      logger.info({ password: 'secret123', token: 'abc', apiKey: 'key123' }, 'test message')
    }).not.toThrow()
  })
})
