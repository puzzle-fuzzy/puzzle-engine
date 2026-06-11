import type { ServerConfig } from '../src/config'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 上传路由 DELETE 端点测试
 *
 * 测试 DELETE /api/upload/:id 的认证守卫、权限校验和业务逻辑。
 * 使用原生 Request + Elysia handle() 绕过 Eden 对 DELETE 的序列化问题。
 */

// ─── Mocks ───────────────────────────────────────────────

const mockGetAccountByEmail = mock(() => Promise.resolve(null))
const mockGetAccountByUsername = mock(() => Promise.resolve(null))
const mockGetAccountById = mock(() => Promise.resolve(null))
const mockCreateAccount = mock(() => Promise.resolve(null))
const mockCreateUploadedFile = mock(() =>
  Promise.resolve({
    id: 'file-001',
    fileName: 'test.png',
    publicUrl: '/uploads/test.png',
    mimeType: 'image/png',
  }),
)
const mockGetUploadedFileById = mock(() => Promise.resolve(null))
const mockDeleteUploadedFileById = mock(() => Promise.resolve(undefined))

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
}))

// eslint-disable-next-line import/first
import { createUploadRoutes } from '../src/routes/upload'

// ─── 测试配置 ────────────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.example.com',
  storageRoot: './test-uploads',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-upload-delete-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
}

function _makeAccount(overrides: Record<string, any> = {}) {
  return {
    id: 'acc-upload-delete',
    username: 'deleteuser',
    email: 'delete@example.com',
    password: 'hashed-password',
    avatar: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

async function getValidToken(): Promise<string> {
  const { treaty } = await import('@elysia/eden')
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: testConfig.jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: 'acc-upload-delete' }))

  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

function makeUploadedFile(overrides: Record<string, any> = {}) {
  return {
    id: 'file-001',
    accountId: 'acc-upload-delete',
    fileName: 'test.png',
    fileSize: 1024,
    mimeType: 'image/png',
    storagePath: 'ref_123/test.png',
    publicUrl: '/uploads/ref_123/test.png',
    purpose: 'reference',
    createdAt: new Date('2024-01-01'),
    ...overrides,
  }
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

    const data = await response.json() as { success: boolean, error?: string }
    expect(data.success).toBe(false)
    expect(data.error).toContain('无权')
    expect(mockDeleteFile).not.toHaveBeenCalled()
    expect(mockDeleteUploadedFileById).not.toHaveBeenCalled()
  })

  it('成功删除自己的文件', async () => {
    const token = await getValidToken()
    mockGetUploadedFileById.mockResolvedValue(makeUploadedFile())

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
