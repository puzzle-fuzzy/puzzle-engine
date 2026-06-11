import type { ServerConfig } from '../config'
import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords } from '@excuse/db'
import { Elysia } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'

export function createBillingRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/billing' })
    .use(createAuthPlugin(config))
    .get('/statistics', async ({ userId }) => {
      if (!userId)
        return { success: false, error: '未登录' }
      const costRecords = await getCostRecords(userId)
      const stats = aggregateStatistics(costRecords)
      return { success: true, statistics: stats }
    })
}
