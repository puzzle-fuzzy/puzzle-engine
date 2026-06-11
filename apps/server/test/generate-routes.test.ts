import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 生成路由单元测试
 *
 * Mock @excuse/db, @excuse/provider, @excuse/billing 全部外部依赖，
 * 测试 /api/generate, /api/records, /api/records/:id, DELETE /api/records/:id 的 HTTP 行为
 */

// ─── Mocks ───────────────────────────────────────────────

const mockCreateRecord = mock(() => Promise.resolve(null))
const mockListRecords = mock(() => Promise.resolve([]))
const mockGetRecordById = mock(() => Promise.resolve(null))
const mockDeleteRecord = mock(() => Promise.resolve(undefined))
const mockMarkFailed = mock(() => Promise.resolve(undefined))
const mockMarkProcessing = mock(() => Promise.resolve(undefined))
const mockMarkSucceeded = mock(() => Promise.resolve(undefined))
const mockCalculateCost = mock(() => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }))
const mockGenerate = mock(() => Promise.resolve({ success: false, error: 'mock error' }))

const mockNotifyStatus = mock(() => Promise.resolve(undefined))
const mockGetUploadedFilesByIdsForAccount = mock(() => Promise.resolve([]))
const mockCancelRecord = mock(() => Promise.resolve(undefined))
const mockResetToPending = mock(() => Promise.resolve(undefined))
const mockFindGenerationByDedupeKeyForAccount = mock(() => Promise.resolve(null))

mock.module('@excuse/db', () => ({
  createGenerationRecord: mockCreateRecord,
  listGenerationRecords: mockListRecords,
  getGenerationRecordById: mockGetRecordById,
  deleteGenerationRecord: mockDeleteRecord,
  markGenerationFailed: mockMarkFailed,
  markGenerationProcessing: mockMarkProcessing,
  markGenerationSucceeded: mockMarkSucceeded,
  notifyGenerationStatus: mockNotifyStatus,
  getUploadedFilesByIdsForAccount: mockGetUploadedFilesByIdsForAccount,
  cancelGenerationRecord: mockCancelRecord,
  resetGenerationToPending: mockResetToPending,
  findGenerationByDedupeKeyForAccount: mockFindGenerationByDedupeKeyForAccount,
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
  },
  getModelById: (id: string) => {
    const models: Record<string, any> = {
      'qwen-max': {
        id: 'qwen-max',
        category: 'text',
        type: 'generation',
        pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
        parameters: [],
        requestType: 'chat',
        inputMapping: { prompt: { target: 'prompt' } },
      },
      'qwen-image-2.0-pro': {
        id: 'qwen-image-2.0-pro',
        category: 'image',
        type: 'generation',
        pricing: { inputPriceCents: 25, unit: 'image' },
        parameters: [],
        requestType: 'image',
        inputMapping: { prompt: { target: 'prompt' } },
      },
      'wan2.1-i2v-t2v-720p': {
        id: 'wan2.1-i2v-t2v-720p',
        category: 'video',
        type: 'generation',
        pricing: { inputPriceCents: 50, unit: 'video' },
        parameters: [],
        requestType: 'video-t2v',
        inputMapping: { prompt: { target: 'prompt' } },
        async: true,
      },
    }
    return models[id]
  },
  AssetStorage: class {
    downloadAndMap = mock(() => Promise.resolve(['https://saved.url/img.png']))
  },
}))

mock.module('@excuse/billing', () => ({
  calculateCost: mockCalculateCost,
}))

// mock.module 提升到 import 之前（Bun 会自动提升 mock.module）
// eslint-disable-next-line import/first
import { createGenerateRoutes } from '../src/routes/generate'

// ─── 测试配置 ────────────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-generate-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
}

function makeRecord(overrides: Record<string, any> = {}) {
  return {
    id: 'rec-001',
    accountId: 'acc-001',
    taskId: 'gen_123_abc',
    model: 'qwen-max',
    category: 'text',
    status: 'succeeded',
    inputParams: {},
    outputResult: {},
    cost: { totalPriceCents: 1, totalPrice: 0.01 },
    errorMessage: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ─── 辅助：获取有效 token ────────────────────────────────

async function getAuthToken(_client: ReturnType<typeof treaty>): Promise<string> {
  // 直接用 Elysia JWT 签一个 token
  const { sign: _sign } = await import('@elysia/jwt')
  // 使用 treaty 的方式不太方便直接签名，用一个简单的 workaround
  // 创建一个小 app 来签发 token
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: testConfig.jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: 'acc-001' }))

  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

// ─── 测试 ────────────────────────────────────────────────

describe('generate routes', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken(client!)
  })

  beforeEach(() => {
    mockCreateRecord.mockClear()
    mockListRecords.mockClear()
    mockGetRecordById.mockClear()
    mockDeleteRecord.mockClear()
    mockMarkFailed.mockClear()
    mockMarkProcessing.mockClear()
    mockMarkSucceeded.mockClear()
    mockCalculateCost.mockClear()
    mockGenerate.mockClear()
    mockNotifyStatus.mockClear()
    mockGetUploadedFilesByIdsForAccount.mockClear()
    mockCancelRecord.mockClear()
    mockResetToPending.mockClear()
    mockFindGenerationByDedupeKeyForAccount.mockClear()
    mockGetUploadedFilesByIdsForAccount.mockClear()

    const app = createGenerateRoutes(testConfig)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/generate
  // ═══════════════════════════════════════════════════

  describe('POST /api/generate', () => {
    it('未登录时返回 401 错误', async () => {
      const { data } = await client.api.generate.post({
        model: 'qwen-max',
        parameters: { prompt: 'test' },
      })

      // auth plugin 应该拦截
      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('未知模型返回错误', async () => {
      const { data } = await client.api.generate.post(
        { model: 'nonexistent', parameters: { prompt: 'test' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // getModelById 返回 undefined → 路由直接返回错误，不创建记录
      expect(data?.success).toBe(false)
      expect(data?.error).toContain('Unknown model')
      expect(mockCreateRecord).not.toHaveBeenCalled()
    })

    it('同步模型（文本）成功时标记为 succeeded', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'succeeded' }))
      mockGenerate.mockResolvedValue({
        success: true,
        output: { text: '你好' },
        usage: { inputTokens: 10, outputTokens: 20 },
      })
      mockCalculateCost.mockReturnValue({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 })

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.record?.status).toBe('succeeded')
      expect(mockMarkSucceeded).toHaveBeenCalled()
    })

    it('同步模型 API 失败时标记为 failed', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'failed' }))
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'API 错误',
      })

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: { prompt: '你好' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(false)
      expect(data?.record?.status).toBe('failed')
      expect(mockMarkFailed).toHaveBeenCalled()
    })

    it('缺少 prompt 参数时由模型验证层拒绝', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord())
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'failed' }))
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'prompt is required',
      })
      mockMarkFailed.mockResolvedValue(undefined)

      const { data } = await client.api.generate.post(
        { model: 'qwen-max', parameters: {} },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(false)
      expect(data?.record?.status).toBe('failed')
    })

    it('异步视频模型返回 providerTaskId，标记为 processing', async () => {
      mockCreateRecord.mockResolvedValue(makeRecord({ category: 'video', model: 'wan2.1-i2v-t2v-720p' }))
      mockGetRecordById.mockResolvedValue(makeRecord({ status: 'processing', category: 'video' }))
      mockGenerate.mockResolvedValue({
        success: true,
        providerTaskId: 'dashscope-task-123',
        output: {},
      })
      mockCalculateCost.mockReturnValue({ unit: 'video', totalPriceCents: 0, totalPrice: 0 })

      const { data } = await client.api.generate.post(
        { model: 'wan2.1-i2v-t2v-720p', parameters: { prompt: '一段视频' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(data?.record?.status).toBe('processing')
      expect(mockMarkProcessing).toHaveBeenCalledWith(
        'rec-001',
        expect.objectContaining({ taskId: 'dashscope-task-123' }),
      )
      expect(mockNotifyStatus).toHaveBeenCalled()
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records
  // ═══════════════════════════════════════════════════

  describe('GET /api/records', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.records.get()

      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('返回用户的生成记录列表', async () => {
      mockListRecords.mockResolvedValue([makeRecord(), makeRecord({ id: 'rec-002' })])

      const { data } = await client.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.records).toHaveLength(2)
      expect(data?.total).toBe(2)
    })

    it('空列表返回空数组', async () => {
      mockListRecords.mockResolvedValue([])

      const { data } = await client.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.records).toHaveLength(0)
      expect(data?.total).toBe(0)
    })

    it('支持 category 筛选', async () => {
      mockListRecords.mockResolvedValue([makeRecord({ category: 'text' })])

      const { data } = await client.api.records.get({
        query: { category: 'text' },
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.records).toHaveLength(1)
      expect(mockListRecords).toHaveBeenCalledWith(
        expect.objectContaining({ category: 'text' }),
      )
    })

    it('支持 limit/offset 分页', async () => {
      mockListRecords.mockResolvedValue([])

      await client.api.records.get({
        query: { limit: 10, offset: 20 },
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(mockListRecords).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 20 }),
      )
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records/:id
  // ═══════════════════════════════════════════════════

  describe('GET /api/records/:id', () => {
    it('未登录时返回错误', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const { data } = await client.api.records({ id: 'rec-001' }).get()

      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('登录后返回自己的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const { data } = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.record).toBeDefined()
    })

    it('记录不存在返回错误', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const { data } = await client.api.records({ id: 'nonexistent' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('not found')
    })

    it('不能查看其他用户的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord({ accountId: 'other-user-id' }))

      const { data } = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('无权')
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /api/records/:id
  // ═══════════════════════════════════════════════════

  describe('DELETE /api/records/:id', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.records({ id: 'rec-001' }).delete()

      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('成功删除自己的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord({ accountId: 'acc-001' }))

      const { data } = await client.api.records({ id: 'rec-001' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(true)
      expect(mockDeleteRecord).toHaveBeenCalledWith('rec-001')
    })

    it('记录不存在返回错误', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const { data } = await client.api.records({ id: 'nonexistent' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('不存在')
    })

    it('不能删除其他用户的记录', async () => {
      mockGetRecordById.mockResolvedValue(
        makeRecord({ accountId: 'other-user-id' }),
      )

      const { data } = await client.api.records({ id: 'rec-001' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('无权')
      expect(mockDeleteRecord).not.toHaveBeenCalled()
    })
  })
})
