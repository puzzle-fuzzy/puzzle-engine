import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 计费统计路由测试
 *
 * Mock @excuse/db 和 @excuse/billing，测试 GET /api/billing/statistics
 */

const mockGetCostRecords = mock(() => Promise.resolve([]))
const mockAggregateStatistics = mock(() => ({
  total: 0,
  today: 0,
  week: 0,
  month: 0,
  byCategory: [],
  byModel: [],
  dailyTrend: [],
}))

mock.module('@excuse/db', () => ({
  getCostRecords: mockGetCostRecords,
}))

mock.module('@excuse/billing', () => ({
  aggregateStatistics: mockAggregateStatistics,
}))

// eslint-disable-next-line import/first
import { billingRoutes } from '../src/routes/billing'

describe('billing routes', () => {
  let client: ReturnType<typeof treaty>

  beforeEach(() => {
    mockGetCostRecords.mockClear()
    mockAggregateStatistics.mockClear()

    const app = billingRoutes
    client = treaty(app)
  })

  describe('GET /statistics', () => {
    it('返回统计数据', async () => {
      mockGetCostRecords.mockResolvedValue([
        { model: 'qwen-max', category: 'text', cost: { totalPrice: 1.5 }, createdAt: new Date().toISOString() },
      ])
      mockAggregateStatistics.mockReturnValue({
        total: 1.5,
        today: 1.5,
        week: 1.5,
        month: 1.5,
        byCategory: [{ category: 'text', total: 1.5, percentage: 100 }],
        byModel: [{ model: 'qwen-max', total: 1.5, percentage: 100 }],
        dailyTrend: [],
      })

      const { data, error } = await client.api.billing.statistics.get()

      expect(error).toBeNull()
      expect(data?.success).toBe(true)
      expect(data?.statistics).toBeDefined()
      expect(data?.statistics.total).toBe(1.5)
    })

    it('空数据返回全零统计', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockReturnValue({
        total: 0,
        today: 0,
        week: 0,
        month: 0,
        byCategory: [],
        byModel: [],
        dailyTrend: [],
      })

      const { data } = await client.api.billing.statistics.get()

      expect(data?.success).toBe(true)
      expect(data?.statistics.total).toBe(0)
      expect(data?.statistics.byCategory).toHaveLength(0)
    })

    it('调用 getCostRecords 获取原始数据', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockReturnValue({
        total: 0,
        today: 0,
        week: 0,
        month: 0,
        byCategory: [],
        byModel: [],
        dailyTrend: [],
      })

      await client.api.billing.statistics.get()

      expect(mockGetCostRecords).toHaveBeenCalledTimes(1)
    })

    it('将原始数据传递给 aggregateStatistics', async () => {
      const records = [
        { model: 'qwen-max', category: 'text', cost: { totalPrice: 5 }, createdAt: '2024-01-01' },
      ]
      mockGetCostRecords.mockResolvedValue(records)
      mockAggregateStatistics.mockReturnValue({
        total: 5,
        today: 0,
        week: 0,
        month: 0,
        byCategory: [],
        byModel: [],
        dailyTrend: [],
      })

      await client.api.billing.statistics.get()

      expect(mockAggregateStatistics).toHaveBeenCalledWith(records)
    })

    it('聚合函数抛出异常时返回错误', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockImplementation(() => {
        throw new Error('Aggregation failed')
      })

      // Elysia 会捕获未处理异常并返回 500
      const { data, error: _error } = await client.api.billing.statistics.get()

      // 不应成功返回
      expect(data?.success).not.toBe(true)
    })
  })
})
