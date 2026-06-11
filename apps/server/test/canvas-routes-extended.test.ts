import type { ServerConfig } from '../src/config'
import { treaty } from '@elysia/eden'
import { beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * Canvas 路由扩展测试
 *
 * 补充 PATCH/DELETE projects、fire-and-forget 管线端点、
 * layout、model-preferences、shots delete/retry 的测试。
 */

// ─── Mock factories ────────────────────────────────────

function makeProjectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'proj-001',
    accountId: 'acc-001',
    title: null,
    storyText: '一段超过十个字的故事文本内容',
    status: 'draft',
    analysisJson: null,
    modelPreferencesJson: null,
    canvasLayout: null,
    isDeleted: false,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

function _makeProjectDetail(projectOverrides: Record<string, unknown> = {}) {
  return {
    project: makeProjectRow(projectOverrides),
    characters: [],
    locations: [],
    shots: [],
    latestContinuity: null,
  }
}

// ─── Mocks ───────────────────────────────────────────────

const mockGetCanvasProjectById = mock<() => Promise<any>>(() => Promise.resolve(null))
const mockGetCanvasProjectDetail = mock<() => Promise<any>>(() => Promise.resolve(null))
const mockUpdateCanvasProject = mock(() => Promise.resolve(makeProjectRow()))
const mockDeleteCanvasLocationById = mock(() => Promise.resolve(undefined))
const mockDeleteCanvasShotById = mock(() => Promise.resolve(undefined))
const mockGetCanvasProjectByIdForAccount = mock(() => Promise.resolve(makeProjectRow()))
const mockGetCanvasCharacterForAccount = mock(() => Promise.resolve({ id: 'char-001' }))
const mockGetCanvasLocationForAccount = mock(() => Promise.resolve({ id: 'loc-001' }))
const mockGetCanvasShotForAccount = mock(() => Promise.resolve({ id: 'shot-001', projectId: 'proj-001' }))
const mockUpdateCanvasCharacter = mock(() => Promise.resolve({ id: 'char-001', name: '新名', updatedAt: new Date() }))
const mockUpdateCanvasLocation = mock(() => Promise.resolve({ id: 'loc-001', updatedAt: new Date() }))
const mockUpdateCanvasShot = mock(() => Promise.resolve({ id: 'shot-001', updatedAt: new Date() }))

mock.module('@excuse/db', () => ({
  createCanvasProject: async () => makeProjectRow(),
  getCanvasProjectById: mockGetCanvasProjectById,
  getCanvasProjectDetail: mockGetCanvasProjectDetail,
  listCanvasProjectsByAccount: async () => [],
  softDeleteCanvasProject: async () => {},
  updateCanvasProject: mockUpdateCanvasProject,
  createCanvasCharacter: async () => ({ id: 'char-001' }),
  getCanvasCharacterById: async () => null,
  updateCanvasCharacter: mockUpdateCanvasCharacter,
  deleteCanvasCharacterById: async () => {},
  deleteCanvasCharactersByProject: async () => {},
  createCanvasLocation: async () => ({ id: 'loc-001' }),
  getCanvasLocationById: async () => null,
  updateCanvasLocation: mockUpdateCanvasLocation,
  deleteCanvasLocationById: mockDeleteCanvasLocationById,
  deleteCanvasLocationsByProject: async () => {},
  createCanvasShot: async () => ({ id: 'shot-001' }),
  batchCreateCanvasShots: async () => [],
  getCanvasShotById: async () => null,
  listCanvasShotsByProject: async () => [],
  updateCanvasShot: mockUpdateCanvasShot,
  deleteCanvasShotsByProject: async () => {},
  deleteCanvasShotById: mockDeleteCanvasShotById,
  getCanvasProjectByIdForAccount: mockGetCanvasProjectByIdForAccount,
  getCanvasCharacterForAccount: mockGetCanvasCharacterForAccount,
  getCanvasLocationForAccount: mockGetCanvasLocationForAccount,
  getCanvasShotForAccount: mockGetCanvasShotForAccount,
  resetCanvasShotToDraft: async () => {},
  listPendingVideoShots: async () => [],
  createContinuityReport: async () => ({ id: 'cont-001' }),
  getLatestContinuityReport: async () => null,
  createGenerationRecord: async () => ({ id: 'gen-001' }),
  markGenerationProcessing: async () => {},
  notifyGenerationStatus: async () => {},
  getGenerationRecordsByTaskIds: async () => [],
  pgClient: { listen: async () => {} },
}))

mock.module('@excuse/provider', () => ({
  DashScopeClient: class {
    chatCompletion = async () => ({ success: true, output: { text: 'mock' } })
    generate = async () => ({ success: true, output: { text: 'mock' } })
  },
  AssetStorage: class { downloadAndMap = async (urls: string[]) => urls },
  getModelById: () => ({ id: 'mock', category: 'text', pricing: { inputPriceCents: 100, unit: 'token' } }),
}))

mock.module('@excuse/billing', () => ({
  calculateCost: () => ({ unit: 'token', totalPriceCents: 1, totalPrice: 0.01 }),
}))

// eslint-disable-next-line import/first
import { createCanvasRoutes } from '../src/routes/canvas'

// ─── Config + auth ──────────────────────────────────────

const testConfig: ServerConfig = {
  port: 0,
  databaseUrl: '',
  dashscopeApiKey: 'test-key',
  dashscopeBaseUrl: 'https://test.local',
  storageRoot: '/tmp/test-uploads',
  frontendUrl: '',
  workerPollIntervalMs: 0,
  jwtSecret: 'test-canvas-ext-secret',
  jwtExpiresIn: '1h',
  oss: undefined,
}

async function getAuthToken(): Promise<string> {
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: testConfig.jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: 'acc-001' }))

  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}

// ─── 测试 ────────────────────────────────────────────────

describe('canvas routes — extended', () => {
  let client: ReturnType<typeof treaty>
  let token: string

  beforeAll(async () => {
    token = await getAuthToken()
  })

  beforeEach(() => {
    for (const m of [
      mockGetCanvasProjectById,
      mockGetCanvasProjectDetail,
      mockUpdateCanvasProject,
      mockDeleteCanvasLocationById,
      mockDeleteCanvasShotById,
      mockUpdateCanvasCharacter,
      mockUpdateCanvasLocation,
      mockUpdateCanvasShot,
      mockGetCanvasProjectByIdForAccount,
      mockGetCanvasCharacterForAccount,
      mockGetCanvasLocationForAccount,
      mockGetCanvasShotForAccount,
    ]) {
      m.mockClear()
    }

    const app = createCanvasRoutes(testConfig)
    client = treaty(app)
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /projects/:projectId
  // ═══════════════════════════════════════════════════

  describe('PATCH /projects/:projectId', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch({
        title: '新标题',
      })
      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('更新项目标题', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow({ title: '新标题' }))
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        { title: '新标题' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })

    it('更新故事文本', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow({ storyText: '更新后的超过十个字的故事' }))
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        { storyText: '更新后的超过十个字的故事' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })

    it('不提供任何字段时返回错误', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).patch(
        {},
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(false)
      expect(data?.error).toContain('至少')
    })
  })

  // ═══════════════════════════════════════════════════
  //  Fire-and-forget 管线端点
  // ═══════════════════════════════════════════════════

  const fireAndForgetEndpoints = [
    { name: 'characters', path: 'characters' },
    { name: 'locations', path: 'locations' },
    { name: 'character-refs', path: 'character-refs' },
    { name: 'location-refs', path: 'location-refs' },
    { name: 'storyboard', path: 'storyboard' },
    { name: 'continuity', path: 'continuity' },
    { name: 'rebuild-prompts', path: 'rebuild-prompts' },
    { name: 'generate-videos', path: 'generate-videos' },
  ] as const

  for (const endpoint of fireAndForgetEndpoints) {
    describe(`POST /projects/:projectId/${endpoint.path}`, () => {
      it(`${endpoint.name} 立即返回成功消息`, async () => {
        mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
        const { data } = await client.api.canvas.projects({ projectId: 'proj-001' })[endpoint.path].post(null, {
          headers: { Authorization: `Bearer ${token}` },
        })
        expect(data?.success).toBe(true)
      })
    })
  }

  // ═══════════════════════════════════════════════════
  //  POST /projects/:projectId/layout
  // ═══════════════════════════════════════════════════

  describe('POST /projects/:projectId/layout', () => {
    it('保存画布布局', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockGetCanvasProjectById.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' }).layout.post(
        { nodes: [{ id: 'n1', x: 100, y: 200 }] },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  PATCH /projects/:projectId/model-preferences
  // ═══════════════════════════════════════════════════

  describe('PATCH /projects/:projectId/model-preferences', () => {
    it('更新模型偏好', async () => {
      mockGetCanvasProjectByIdForAccount.mockResolvedValue(makeProjectRow())
      mockUpdateCanvasProject.mockResolvedValue(makeProjectRow())
      const { data } = await client.api.canvas.projects({ projectId: 'proj-001' })['model-preferences'].patch(
        { textModel: 'qwen-max', videoModel: 'wan2.1-t2v' },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      expect(data?.success).toBe(true)
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /locations/:locationId
  // ═══════════════════════════════════════════════════

  describe('DELETE /locations/:locationId', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.canvas.locations({ locationId: 'loc-001' }).delete()
      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('登录后删除场景', async () => {
      mockGetCanvasLocationForAccount.mockResolvedValue({ id: 'loc-001' })
      const { data } = await client.api.canvas.locations({ locationId: 'loc-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockDeleteCanvasLocationById).toHaveBeenCalledWith('loc-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  DELETE /shots/:shotId
  // ═══════════════════════════════════════════════════

  describe('DELETE /shots/:shotId', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).delete()
      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('登录后删除镜头', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).delete(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
      expect(mockDeleteCanvasShotById).toHaveBeenCalledWith('shot-001')
    })
  })

  // ═══════════════════════════════════════════════════
  //  POST /shots/:shotId/retry
  // ═══════════════════════════════════════════════════

  describe('POST /shots/:shotId/retry', () => {
    it('未登录时返回错误', async () => {
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).retry.post()
      expect(data?.success === false || data === undefined).toBe(true)
    })

    it('登录后立即返回成功（fire-and-forget）', async () => {
      mockGetCanvasShotForAccount.mockResolvedValue({ id: 'shot-001', projectId: 'proj-001' })
      const { data } = await client.api.canvas.shots({ shotId: 'shot-001' }).retry.post(null, {
        headers: { Authorization: `Bearer ${token}` },
      })
      expect(data?.success).toBe(true)
    })
  })
})
