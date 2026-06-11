import type { ServerConfig } from '../config'
import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords } from '@excuse/db'
import { Elysia } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { unauthorized } from '../utils/errors'

export function createBillingRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/billing' })
    .use(createAuthPlugin(config))
    .get('/statistics', async ({ userId, set }) => {
      if (!userId)
        return unauthorized(set, '未登录')
      const costRecords = await getCostRecords(userId)
      const stats = aggregateStatistics(costRecords)
      return { success: true, statistics: stats }
    })
}
