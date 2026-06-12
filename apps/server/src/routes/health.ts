import { Elysia } from 'elysia'

/**
 * 健康检查路由
 *
 * GET /api/health — 返回 { status: 'ok', timestamp }
 * 用于前端/负载均衡/监控系统探测服务可用性
 */
export const healthRoutes = new Elysia({ prefix: '/api/health' })
  .get('/', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }), {
    detail: {
      summary: '健康检查',
      description: '返回服务运行状态，用于负载均衡和监控系统探测可用性',
      tags: ['健康检查'],
    },
  })
