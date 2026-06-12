import type { ServerConfig } from '../config'
import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords } from '@excuse/db'
import { Elysia } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { unauthorized } from '../utils/errors'

/**
 * 费用统计路由
 *
 * GET /api/billing/statistics — 返回当前用户所有生成任务的累计费用聚合
 * 依赖 @excuse/billing 的 aggregateStatistics 做按模型/类别的费用汇总
 */
export function createBillingRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/billing' })
    .use(createAuthPlugin(config))
    .get('/statistics', async ({ userId, set }) => {
      if (!userId)
        return unauthorized(set, '未登录')
      const costRecords = await getCostRecords(userId)
      const stats = aggregateStatistics(costRecords)
      return { success: true, statistics: stats }
    }, {
      detail: {
        summary: '获取费用统计',
        description: '返回当前用户所有生成任务的累计费用聚合数据，按模型和类别分组',
        tags: ['计费'],
        security: [{ bearerAuth: [] }],
      },
    })
}
