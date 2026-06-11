import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords } from '@excuse/db'
import type { ServerConfig } from '../config'
import { Elysia } from 'elysia'

export function createBillingRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/billing' })
    .get('/statistics', async ({ userId }) => {
      if (!userId)
        return { success: false, error: '未登录' }
      const costRecords = await getCostRecords(userId)
      const stats = aggregateStatistics(costRecords)
      return { success: true, statistics: stats }
    })
}