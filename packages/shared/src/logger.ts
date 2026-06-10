import pino from 'pino'

export type Logger = pino.Logger

/**
 * 创建应用 Logger
 *
 * - 生产环境：JSON 结构化日志（NDJSON，方便日志采集）
 * - 开发环境：pino-pretty 彩色可读输出
 * - 内置 redact 脱敏：自动隐藏 password / token / secret / apiKey 等字段
 */
export function createLogger(name: string, options?: pino.LoggerOptions): Logger {
  const isDev = process.env.NODE_ENV !== 'production'

  const transport = isDev
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
      // 脱敏：匹配到的字段自动替换为 [Redacted]
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

/** 全局单例 Logger，用于整个应用 */
export const logger = createLogger('excuse')
