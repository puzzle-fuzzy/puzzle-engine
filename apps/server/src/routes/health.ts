import { pgClient } from '@excuse/db'
import { Elysia } from 'elysia'
import { getOnlineUserCount } from '../services/sse-manager'
import { getMetrics } from '../services/metrics'

let startTime = Date.now()

/**
 * 健康检查路由
 *
 * GET /api/health — 返回服务状态、DB 连接、SSE 连接数、uptime
 * GET /api/health/metrics — 返回详细指标（请求数、延迟、错误率）
 */
export function createHealthRoutes() {
  return new Elysia({ prefix: '/api/health' })
    .get('/', async () => {
      let dbStatus = 'ok'
      try {
        await pgClient`SELECT 1`
      }
      catch {
        dbStatus = 'error'
      }

      return {
        status: dbStatus === 'ok' ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: Math.floor((Date.now() - startTime) / 1000),
        db: dbStatus,
        sseConnections: getOnlineUserCount(),
        version: process.env.npm_package_version ?? '0.1.0',
      }
    }, {
      detail: {
        summary: '健康检查',
        description: '返回服务运行状态、DB 连接、uptime、SSE 连接数和版本号',
        tags: ['健康检查'],
      },
    })
    .get('/metrics', () => {
      const uptime = Math.floor((Date.now() - startTime) / 1000)
      return getMetrics(getOnlineUserCount(), uptime)
    }, {
      detail: {
        summary: '服务指标',
        description: '返回请求计数、延迟分布（p50/p95/p99）、错误率、SSE 在线用户数',
        tags: ['健康检查'],
      },
    })
}

/** 重置 uptime 计时起点（测试用） */
export function resetHealthStartTime() {
  startTime = Date.now()
}
