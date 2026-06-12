import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { extractEdenError, makeTestConfig, signTestToken } from './helpers/test-factory'

/**
 * 计费统计路由测试
 *
 * Mock @excuse/db 和 @excuse/billing，测试 GET /api/billing/statistics
 */

const mockGetCostRecords = mock<() => Promise<unknown[]>>(() => Promise.resolve([]))
const mockGetOrCreateCreditAccount = mock(() => Promise.resolve({
  id: 'credit-001',
  accountId: 'acc-001',
  availableCents: 1200,
  frozenCents: 300,
  createdAt: new Date('2024-01-01T00:00:00Z'),
  updatedAt: new Date('2024-01-01T00:00:00Z'),
}))
const mockListCreditTransactions = mock(() => Promise.resolve([
  {
    id: 'tx-001',
    accountId: 'acc-001',
    type: 'credit',
    amountCents: 1200,
    balanceAfterCents: 1200,
    frozenAfterCents: 0,
    generationRecordId: null,
    description: '充值',
    metadata: null,
    createdAt: new Date('2024-01-02T00:00:00Z'),
  },
]))
const mockAggregateStatistics = mock<() => Record<string, unknown>>(() => ({
  totalCents: 0,
  total: 0,
  todayCents: 0,
  today: 0,
  weekCents: 0,
  week: 0,
  monthCents: 0,
  month: 0,
  auditFailedCents: 0,
  byCategory: [],
  byModel: [],
  dailyTrend: [],
}))

mock.module('@excuse/db', () => ({
  getCostRecords: mockGetCostRecords,
  getOrCreateCreditAccount: mockGetOrCreateCreditAccount,
  listCreditTransactions: mockListCreditTransactions,
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
  let app: ReturnType<typeof createBillingRoutes>
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    mockGetCostRecords.mockClear()
    mockGetOrCreateCreditAccount.mockClear()
    mockListCreditTransactions.mockClear()
    mockAggregateStatistics.mockClear()

    app = createBillingRoutes(testConfig)
    client = treaty(app)
  })

  describe('GET /statistics', () => {
    it('未登录时返回错误', async () => {
      const res = await client.api.billing.statistics.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.error).toContain('登录')
    })

    it('登录后返回统计数据', async () => {
      mockGetCostRecords.mockResolvedValue([
        { model: 'qwen-max', category: 'text', cost: { totalPrice: 1.5 }, createdAt: new Date().toISOString() },
      ])
      mockAggregateStatistics.mockReturnValue({
        totalCents: 150,
        total: 1.5,
        todayCents: 150,
        today: 1.5,
        weekCents: 150,
        week: 1.5,
        monthCents: 150,
        month: 1.5,
        auditFailedCents: 0,
        byCategory: [{ category: 'text', totalCents: 150, total: 1.5, percentage: 100 }],
        byModel: [{ model: 'qwen-max', totalCents: 150, total: 1.5, percentage: 100 }],
        dailyTrend: [],
      })

      const { data } = await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.data).toBeDefined()
      expect(data?.data.total).toBe(1.5)
    })

    it('空数据返回全零统计', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockReturnValue({
        totalCents: 0,
        total: 0,
        todayCents: 0,
        today: 0,
        weekCents: 0,
        week: 0,
        monthCents: 0,
        month: 0,
        auditFailedCents: 0,
        byCategory: [],
        byModel: [],
        dailyTrend: [],
      })

      const { data } = await client.api.billing.statistics.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.data.total).toBe(0)
      expect(data?.data.byCategory).toHaveLength(0)
    })

    it('调用 getCostRecords 获取原始数据', async () => {
      mockGetCostRecords.mockResolvedValue([])
      mockAggregateStatistics.mockReturnValue({
        totalCents: 0,
        total: 0,
        todayCents: 0,
        today: 0,
        weekCents: 0,
        week: 0,
        monthCents: 0,
        month: 0,
        auditFailedCents: 0,
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
        totalCents: 500,
        total: 5,
        todayCents: 0,
        today: 0,
        weekCents: 0,
        week: 0,
        monthCents: 0,
        month: 0,
        auditFailedCents: 0,
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

  describe('GET /balance', () => {
    it('登录后返回余额 data DTO', async () => {
      const { data } = await client.api.billing.balance.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.data).toEqual({
        availableCents: 1200,
        frozenCents: 300,
        totalCents: 1500,
      })
    })
  })

  describe('GET /transactions', () => {
    it('登录后返回列表 items DTO，并序列化 createdAt', async () => {
      const response = await app.handle(new Request('http://localhost/api/billing/transactions?limit=10&offset=0', {
        headers: { Authorization: `Bearer ${token}` },
      }))
      const data = await response.json() as {
        success: true
        items: Array<{ createdAt: string }>
        total: number
      }

      expect(data.success).toBe(true)
      expect(data.items).toHaveLength(1)
      expect(data.items[0]?.createdAt).toBe('2024-01-02T00:00:00.000Z')
      expect(data.total).toBe(1)
    })

    it('Eden 客户端返回列表响应结构', async () => {
      const { data } = await client.api.billing.transactions.get({
        headers: { Authorization: `Bearer ${token}` },
        query: { limit: 10, offset: 0 },
      })

      expect(data?.success).toBe(true)
      expect(data?.items).toHaveLength(1)
      expect(data?.total).toBe(1)
    })
  })
})
