import pino from 'pino'

export type Logger = pino.Logger

/** 浏览器环境：pino 降级为 console 输出（无 transport、无 redact） */
function createBrowserLogger(name: string): Logger {
  return pino({ name, level: 'debug' })
}

/** Node.js 环境：完整 pino + pino-pretty / redact */
function createNodeLogger(name: string, options?: pino.LoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== 'production'

  const transport = isDev && typeof pino.transport === 'function'
    ? pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
        },
      })
    : undefined

  return pino(
    {
      name,
      level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
      redact: {
        paths: [
          'password',
          'token',
          'secret',
          'apiKey',
          'accessKeyId',
          'accessKeySecret',
          'authorization',
          '*.password',
          '*.token',
          '*.secret',
          '*.apiKey',
        ],
        censor: '[Redacted]',
      },
      ...options,
    },
    transport,
  )
}

/**
 * 创建应用 Logger
 *
 * - Node.js: JSON 结构化日志 + pino-pretty(开发) + redact 脱敏
 * - 浏览器: pino 降级为 console 输出
 */
export function createLogger(name: string, options?: pino.LoggerOptions): Logger {
  return typeof globalThis !== 'undefined' && typeof (globalThis as any).window !== 'undefined'
    ? createBrowserLogger(name)
    : createNodeLogger(name, options)
}

/** 全局单例 Logger，用于整个应用 */
export const logger = createLogger('excuse')
