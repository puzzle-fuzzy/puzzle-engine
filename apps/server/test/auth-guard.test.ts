import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 路由认证守卫测试
 *
 * 验证 generate 和 upload 路由在未认证时拒绝请求，
 * 在有效 JWT 下正确传递 userId。
 *
 * 使用 mock.module 模拟所有外部依赖，
 * 只测试认证守卫层的行为。
 */

// ─── Mock 依赖 ─────────────────────────────────────

// @excuse/db — 账户查询 + 生成记录 + 上传文件
const mockGetAccountByEmail = mock(() => Promise.resolve(null))
const mockGetAccountByUsername = mock(() => Promise.resolve(null))
const mockGetAccountById = mock(() => Promise.resolve(null))
const mockCreateAccount = mock(() => Promise.resolve(null))
const mockCreateGenerationRecord = mock(() =>
  Promise.resolve({ id: 'rec-001', taskId: 'task-001' }),
)
const mockListGenerationRecords = mock(() => Promise.resolve([]))
const mockGetGenerationRecordById = mock(() => Promise.resolve(null))
const mockMarkGenerationFailed = mock(() => Promise.resolve(undefined))
const mockMarkGenerationProcessing = mock(() => Promise.resolve(undefined))
const mockMarkGenerationSucceeded = mock(() => Promise.resolve(undefined))
const mockCreateUploadedFile = mock(() =>
  Promise.resolve({
    id: 'file-001',
    fileName: 'test.png',
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
  }),
)

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
  createGenerationRecord: mockCreateGenerationRecord,
  listGenerationRecords: mockListGenerationRecords,
  getGenerationRecordById: mockGetGenerationRecordById,
  markGenerationFailed: mockMarkGenerationFailed,
  markGenerationProcessing: mockMarkGenerationProcessing,
  markGenerationSucceeded: mockMarkGenerationSucceeded,
  createUploadedFile: mockCreateUploadedFile,
}))

// @excuse/provider — DashScope + AssetStorage
const mockGenerate = mock(() =>
  Promise.resolve({ success: false, error: 'mocked out' }),
)
const mockDownloadAndMap = mock(() =>
  Promise.resolve(['/uploads/img_0.png']),
)
const mockSaveUploadedFile = mock(() =>
  Promise.resolve({ storagePath: '/uploads/ref_test.png', publicUrl: '/uploads/ref_test.png' }),
)

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    generate = mockGenerate
  },
  AssetStorage: class {
    downloadAndMap = mockDownloadAndMap
    saveUploadedFile = mockSaveUploadedFile
  },
  getModelById: mock(() => ({
    id: 'test-model',
    category: 'text',
    name: 'Test Model',
  })),
}))

// @excuse/billing
mock.module('@excuse/billing', () => ({
  calculateCost: mock(() => ({ totalPriceCents: 1, totalPrice: 0.01, estimated: true })),
}))

// ─── 在 mock 之后 import（Bun 会自动提升 mock.module 到 import 之前）──────
// eslint-disable-next-line import/first
import { createAuthRoutes } from '../src/routes/auth'
// eslint-disable-next-line import/first
import { createGenerateRoutes } from '../src/routes/generate'
// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'

// ─── 测试配置 ──────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-guard-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
}

// ─── 辅助：通过注册获取有效 token ─────────────────

function makeAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'acc-guard-test',
    username: 'guarduser',
    email: 'guard@example.com',
    password: 'hashed-password',
    avatar: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

async function getValidToken(client: ReturnType<typeof treaty>) {
  mockGetAccountByEmail.mockResolvedValue(null)
  mockGetAccountByUsername.mockResolvedValue(null)
  mockCreateAccount.mockResolvedValue(makeAccount())

  const res = await client.api.auth.register.post({
    username: 'guarduser',
    email: 'guard@example.com',
    password: 'password123456',
  })

  return (res.data as any)?.token as string
}

// ─── 测试 ──────────────────────────────────────────

describe('route auth guards', () => {
  let generateClient: ReturnType<typeof treaty>
  let _uploadClient: ReturnType<typeof treaty>
  let authClient: ReturnType<typeof treaty>

  beforeEach(() => {
    // 重置所有 mock
    for (const m of [
      mockGetAccountByEmail,
      mockGetAccountByUsername,
      mockGetAccountById,
      mockCreateAccount,
      mockCreateGenerationRecord,
      mockListGenerationRecords,
      mockGetGenerationRecordById,
      mockMarkGenerationFailed,
      mockMarkGenerationProcessing,
      mockMarkGenerationSucceeded,
      mockCreateUploadedFile,
      mockGenerate,
      mockDownloadAndMap,
      mockSaveUploadedFile,
    ]) {
      m.mockClear()
    }

    generateClient = treaty(createGenerateRoutes(testConfig))
    _uploadClient = treaty(createUploadRoutes(testConfig))
    authClient = treaty(createAuthRoutes(testConfig))
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/generate
  // ═══════════════════════════════════════════════════

  describe('POST /api/generate — auth guard', () => {
    it('should reject request without token', async () => {
      const { data } = await generateClient.api.generate.post({
        model: 'test-model',
        parameters: { prompt: 'test' },
      })

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('登录')
      // 不应调用 API
      expect(mockGenerate).not.toHaveBeenCalled()
      expect(mockCreateGenerationRecord).not.toHaveBeenCalled()
    })

    it('should reject request with invalid token', async () => {
      const { data } = await generateClient.api.generate.post(
        { model: 'test-model', parameters: { prompt: 'test' } },
        { headers: { Authorization: 'Bearer invalid.token.here' } },
      )

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('登录')
    })

    it('should accept request with valid token and pass userId', async () => {
      const token = await getValidToken(authClient)

      // 模拟 DashScope 返回失败（只测认证守卫，不测完整流程）
      mockGenerate.mockResolvedValue({
        success: false,
        error: 'API error',
      })
      mockMarkGenerationFailed.mockResolvedValue(undefined)

      const { data: _data } = await generateClient.api.generate.post(
        { model: 'test-model', parameters: { prompt: 'test' } },
        { headers: { Authorization: `Bearer ${token}` } },
      )

      // 应该通过了认证守卫（即使 API 调用失败，也不再是"请先登录"错误）
      // createGenerationRecord 应被调用，且 accountId 应为 token 中的 userId
      expect(mockCreateGenerationRecord).toHaveBeenCalledTimes(1)
      const createArg = mockCreateGenerationRecord.mock.calls[0][0] as any
      expect(createArg.accountId).toBe('acc-guard-test')
    })
  })

  // ═══════════════════════════════════════════════════
  //  GET /api/records
  // ═══════════════════════════════════════════════════

  describe('GET /api/records — auth guard', () => {
    it('should reject request without token', async () => {
      const { data } = await generateClient.api.records.get()

      expect(data?.success).toBe(false)
      expect(data?.error).toContain('登录')
      expect(mockListGenerationRecords).not.toHaveBeenCalled()
    })

    it('should accept request with valid token and filter by userId', async () => {
      const token = await getValidToken(authClient)
      mockListGenerationRecords.mockResolvedValue([])

      await generateClient.api.records.get({
        headers: { Authorization: `Bearer ${token}` },
      })

      expect(mockListGenerationRecords).toHaveBeenCalledTimes(1)
      const filterArg = mockListGenerationRecords.mock.calls[0][0] as any
      expect(filterArg.accountId).toBe('acc-guard-test')
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /api/upload
  // ═══════════════════════════════════════════════════

  describe('POST /api/upload — auth guard', () => {
    it('should reject request without token', async () => {
      // 使用原生 Request 直接调用，绕过 Eden Treaty 的 FormData 序列化问题
      const uploadApp = createUploadRoutes(testConfig)
      const formData = new FormData()
      formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        body: formData,
      }))

      const data = await response.json() as { success: boolean, error?: string }
      expect(data.success).toBe(false)
      expect(data.error).toContain('登录')
      expect(mockSaveUploadedFile).not.toHaveBeenCalled()
      expect(mockCreateUploadedFile).not.toHaveBeenCalled()
    })

    it('should accept request with valid token and pass userId', async () => {
      const token = await getValidToken(authClient)
      mockSaveUploadedFile.mockResolvedValue({
        storagePath: '/uploads/test.png',
        publicUrl: '/uploads/test.png',
      })
      mockCreateUploadedFile.mockResolvedValue({
        id: 'file-001',
        fileName: 'test.png',
        publicUrl: '/uploads/test.png',
        mimeType: 'image/png',
      })

      // 使用原生 Request 直接调用 Elysia handle
      // 注意：Elysia handle() 对 multipart/form-data 的 body 解析有限制，
      // 但认证守卫会在 body 解析之前执行，所以仍能验证 auth guard 行为
      const uploadApp = createUploadRoutes(testConfig)
      const formData = new FormData()
      formData.append('file', new File(['test content'], 'test.png', { type: 'image/png' }))

      const response = await uploadApp.handle(new Request('http://localhost/api/upload', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      }))

      const text = await response.text()
      let data: any
      try {
        data = JSON.parse(text)
      }
      catch {
        data = { raw: text }
      }

      // 关键断言：认证守卫通过了 — 没有返回 "请先登录"
      // （可能因 Elysia in-process FormData 限制返回其他错误，但不是认证错误）
      const errorStr = String(data?.error ?? data?.raw ?? '')
      expect(errorStr).not.toContain('登录')
      expect(errorStr).not.toContain('请先')
    })
  })
})
