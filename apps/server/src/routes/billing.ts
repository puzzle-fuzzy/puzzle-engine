import { aggregateStatistics } from '@excuse/billing'
import { getCostRecords } from '@excuse/db'
import { Elysia } from 'elysia'

export const billingRoutes = new Elysia({ prefix: '/api/billing' })
  .get('/statistics', async () => {
    const costRecords = await getCostRecords()
    const stats = aggregateStatistics(costRecords)
    return { success: true, statistics: stats }
  })
