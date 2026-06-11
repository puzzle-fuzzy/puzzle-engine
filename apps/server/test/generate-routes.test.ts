import type { GenerationRecordRow } from '@excuse/db'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 生成路由单元测试
 *
 * Mock @excuse/db, @excuse/provider, @excuse/billing 全部外部依赖，
 * 测试 /api/generate, /api/records, /api/records/:id, DELETE /api/records/:id 的 HTTP 行为
 */

// ─── Mock 类型 ───────────────────────────────────────────────

import { extractEdenError, makeRecord, makeTestConfig, signTestToken } from './helpers/test-factory'

/** Provider 返回结构（涵盖同步/异步/成功/失败所有变体） */
interface MockProviderResult {
  success: boolean
  error?: string
  output?: Record<string, unknown>
  usage?: Record<string, unknown>
  providerTaskId?: string
}

// ─── Mocks ───────────────────────────────────────────────

type RecordOrNull = GenerationRecordRow | null

const mockCreateRecord = mock<() => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockListRecords = mock<(filter: Record<string, unknown>) => Promise<GenerationRecordRow[]>>(() => Promise.resolve([]))
const mockGetRecordById = mock<(id: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))
const mockDeleteRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkFailed = mock<(id: string, error: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkProcessing = mock<(id: string, data: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockMarkSucceeded = mock<(id: string, output: unknown, cost: unknown) => Promise<void>>(() => Promise.resolve(undefined))
const mockCalculateCost = mock<() => Record<string, unknown>>(() => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }))
const mockGenerate = mock<(model: string, params: Record<string, unknown>, refs?: string[]) => Promise<MockProviderResult>>(() =>
  Promise.resolve({ success: false, error: 'mock error' }),
)

const mockNotifyStatus = mock<(payload: Record<string, unknown>) => Promise<void>>(() => Promise.resolve(undefined))
const mockGetUploadedFilesByIdsForAccount = mock<(ids: string[], accountId: string) => Promise<unknown[]>>(() => Promise.resolve([]))
const mockCancelRecord = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockResetToPending = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))
const mockFindGenerationByDedupeKeyForAccount = mock<(key: string, accountId: string) => Promise<RecordOrNull>>(() => Promise.resolve(null))

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
    const models: Record<string, unknown> = {
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

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  jwtSecret: 'test-generate-secret',
})

// ─── 辅助：获取有效 token ────────────────────────────────

async function getAuthToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-001')
}

// ─── 测试 ────────────────────────────────────────────────

describe('generate routes', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
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
      const res = await client.api.generate.post({
        model: 'qwen-max',
        parameters: { prompt: 'test' },
      })

      // auth plugin 应该拦截 — 401
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('未知模型返回 422 错误', async () => {
      const res = await client.api.generate.post(
        { model: 'nonexistent', parameters: { prompt: 'test' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // getModelById 返回 undefined → validationError 422
      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(422)
      expect(err!.error).toContain('Unknown model')
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

    it('同步模型 API 失败时标记为 failed（HTTP 200 业务失败）', async () => {
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

      // Provider 失败是业务层面失败，路由仍返回 HTTP 200
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

      // Provider 拒绝 = 业务失败，HTTP 200
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
    it('未登录时返回 401 错误', async () => {
      const res = await client.api.records.get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
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
    it('未登录时返回 401 错误', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const res = await client.api.records({ id: 'rec-001' }).get()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
    })

    it('登录后返回自己的记录', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord())

      const { data } = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(data?.success).toBe(true)
      expect(data?.record).toBeDefined()
    })

    it('记录不存在返回 404', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(404)
      expect(err!.error).toContain('不存在')
    })

    it('不能查看其他用户的记录（403）', async () => {
      mockGetRecordById.mockResolvedValue(makeRecord({ accountId: 'other-user-id' }))

      const res = await client.api.records({ id: 'rec-001' }).get({
        headers: { Authorization: `Bearer ${token}` },
      })

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('无权')
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /api/records/:id
  // ═══════════════════════════════════════════════════

  describe('DELETE /api/records/:id', () => {
    it('未登录时返回 401 错误', async () => {
      const res = await client.api.records({ id: 'rec-001' }).delete()

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(401)
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

    it('记录不存在返回 404', async () => {
      mockGetRecordById.mockResolvedValue(null)

      const res = await client.api.records({ id: 'nonexistent' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(404)
      expect(err!.error).toContain('不存在')
    })

    it('不能删除其他用户的记录（403）', async () => {
      mockGetRecordById.mockResolvedValue(
        makeRecord({ accountId: 'other-user-id' }),
      )

      const res = await client.api.records({ id: 'rec-001' }).delete(
        null,
        { headers: { Authorization: `Bearer ${token}` } },
      )

      const err = extractEdenError(res)
      expect(err).toBeTruthy()
      expect(err!.status).toBe(403)
      expect(err!.error).toContain('无权')
      expect(mockDeleteRecord).not.toHaveBeenCalled()
    })
  })
})
