import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { makeTestConfig, makeUploadedFile, makeValidatedParams, signTestToken } from './helpers/test-factory'

/**
 * 上传路由 DELETE 端点测试
 *
 * 测试 DELETE /api/upload/:id 的认证守卫、权限校验和业务逻辑。
 * 使用原生 Request + Elysia handle() 绕过 Eden 对 DELETE 的序列化问题。
 */

// ─── Mock 类型 ───────────────────────────────────────────────

interface MockUploadedFile {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  mimeType: string
  storagePath: string
  publicUrl: string
  purpose: string
  createdAt: Date
}

// ─── Mocks ───────────────────────────────────────────────

const mockGetAccountByEmail = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockGetAccountByUsername = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockGetAccountById = mock<() => Promise<unknown | null>>(() => Promise.resolve(null))
const mockCreateAccount = mock<(values: Record<string, unknown>) => Promise<unknown | null>>(() => Promise.resolve(null))
const mockCreateUploadedFile = mock<(values: Record<string, unknown>) => Promise<{ id: string, fileName: string, publicUrl: string, mimeType: string }>>(() =>
  Promise.resolve({
    id: 'file-001',
    fileName: 'test.png',
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
  }),
)
const mockGetUploadedFileById = mock<(id: string) => Promise<MockUploadedFile | null>>(() => Promise.resolve(null))
const mockDeleteUploadedFileById = mock<(id: string) => Promise<void>>(() => Promise.resolve(undefined))

mock.module('@excuse/db', () => ({
  getAccountByEmail: mockGetAccountByEmail,
  getAccountByUsername: mockGetAccountByUsername,
  getAccountById: mockGetAccountById,
  createAccount: mockCreateAccount,
  createUploadedFile: mockCreateUploadedFile,
  getUploadedFileById: mockGetUploadedFileById,
  deleteUploadedFileById: mockDeleteUploadedFileById,
}))

const mockSaveUploadedFile = mock(() =>
  Promise.resolve({ storagePath: '/uploads/ref_test.png', publicUrl: '/uploads/ref_test.png' }),
)
const mockDeleteFile = mock(() => Promise.resolve(undefined))

mock.module('@excuse/provider', () => ({
  AssetStorage: class {
    saveUploadedFile = mockSaveUploadedFile
    deleteFile = mockDeleteFile
  },
  DashScopeClient: class {},
  getModelById: () => undefined,
  mergeWithDefaults: (_modelConfig: unknown, params: Record<string, unknown>) => params,
  validateModelParameters: () => ({ valid: true, errors: [] }),
  validateAndMerge: (_modelConfig: unknown, params: Record<string, unknown>) => ({ ok: true, params: makeValidatedParams(params) }),
}))

// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'

// ─── 测试配置 ────────────────────────────────────────────

const testConfig = makeTestConfig({
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  jwtSecret: 'test-upload-delete-secret',
})

async function getValidToken(): Promise<string> {
  return signTestToken(testConfig.jwtSecret, 'acc-upload-delete')
}

// ─── 测试 ────────────────────────────────────────────────

describe('upload routes — DELETE /api/upload/:id', () => {
  let uploadApp: ReturnType<typeof createUploadRoutes>

  beforeEach(() => {
    for (const m of [
      mockGetAccountByEmail,
      mockGetAccountByUsername,
      mockGetAccountById,
      mockCreateAccount,
      mockCreateUploadedFile,
      mockSaveUploadedFile,
      mockGetUploadedFileById,
      mockDeleteUploadedFileById,
      mockDeleteFile,
    ]) {
      m.mockClear()
    }

    uploadApp = createUploadRoutes(testConfig)
  })

  it('未登录时返回"请先登录"', async () => {
    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
    }))

    expect(response.status).toBe(401)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('登录')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
  })

  it('文件不存在时返回错误', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(null)

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/nonexistent', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(404)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('不存在')
    expect(mockDeleteFile).not.toHaveBeenCalled()
  })

  it('不能删除其他用户的文件', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'other-user' }))

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    expect(response.status).toBe(403)
    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('无权')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
  })

  it('成功删除自己的文件', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile({ accountId: 'acc-upload-delete' }))

    const response = await uploadApp.handle(new Request('http://localhost/api/upload/file-001', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    }))

    const data = await response.json() as { success: boolean }
    expect(data.success).toBe(true)
    expect(mockDeleteFile).toHaveBeenCalledWith('ref_123/test.png')
    expect(mockDeleteUploadedFileById).toHaveBeenCalledWith('file-001')
  })
})
