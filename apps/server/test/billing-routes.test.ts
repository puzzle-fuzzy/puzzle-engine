import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeTestConfig, signTestToken } from './helpers/test-factory'

/**
 * 计费统计路由测试
 *
 * Mock @excuse/db 和 @excuse/billing，测试 GET /api/billing/statistics
 */

const mockGetCostRecords = mock<() => Promise<unknown[]>>(() => Promise.resolve([]))
const mockAggregateStatistics = mock<() => Record<string, unknown>>(() => ({
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
import { createBillingRoutes } from '../src/routes/billing'

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-billing-secret',
})

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

describe('billing routes', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockGetCostRecords.mockClear()
    mockAggregateStatistics.mockClear()

    const app = createBillingRoutes(testConfig)
    client = treaty(app)
  })

  describe('GET /statistics', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.billing.statistics.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('未登录')
    })

    it('登录后返回统计数据', async () => {
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

      const { data } = await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

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

      const { data } = await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

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

      await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

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

      await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(mockAggregateStatistics).toHaveBeenCalledWith(records)
    })

    it('聚合函数抛出异常时返回错误', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockImplementation(() => {
        throw new Error('Aggregation failed')
      })

      const { data } = await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).not.toBe(true)
    })
  })
})
