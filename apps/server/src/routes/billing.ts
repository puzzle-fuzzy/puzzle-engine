import { Elysia } from 'elysia'
import { getCostRecords } from '@excuse/db'
import { aggregateStatistics } from '@excuse/billing'

export const billingRoutes = new Elysia({ prefix: '/api/billing' })
  .get('/statistics', async () => {
    const costRecords = await getCostRecords()
    const stats = aggregateStatistics(costRecords)
    return { success: true, statistics: stats }
  })
