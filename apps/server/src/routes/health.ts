import { pgClient } from '@excuse/db'
import { Elysia } from 'elysia'

let startTime = Date.now()

/**
 * 健康检查路由
 *
 * GET /api/health — 返回服务状态、DB 连接、SSE 连接数、uptime
 * 用于前端/负载均衡/监控系统探测服务可用性
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
        version: process.env.npm_package_version ?? '0.1.0',
      }
    }, {
      detail: {
        summary: '健康检查',
        description: '返回服务运行状态、DB 连接、uptime 和版本号',
        tags: ['健康检查'],
      },
    })
}

/** 重置 uptime 计时起点（测试用） */
export function resetHealthStartTime() {
  startTime = Date.now()
}
