/**
 * 共享测试工厂函数
 *
 * 为 server 测试提供类型安全的数据构造器，替代各文件中重复的 makeAccount / testConfig / makeRecord 等。
 * 所有工厂都接受 Partial<Overrides> 参数，未覆盖的字段使用合理默认值。
 */
import type { AccountRow, GenerationRecordRow, UploadedFileRow } from '@excuse/db'
import type { ServerConfig } from '../../src/config'

// ===== Account 工厂 =====

/**
 * 构造 AccountRow 测试数据
 *
 * 默认值: id='acc-test', username='testuser', email='test@example.com'
 * 传入 overrides 覆盖任意字段，保留其余默认值
 */
export function makeAccount(overrides: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-test',
    username: 'testuser',
    email: 'test@example.com',
    password: 'hashed-password',
    avatar: null,
    isActive: true,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

// ===== GenerationRecord 工厂 =====

/** 构造成功状态的 GenerationRecordRow 测试数据 */
export function makeRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
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
    dedupeKey: null,
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...overrides,
  }
}

/** 构造 failed 状态的 GenerationRecordRow */
export function makeFailedRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  return makeRecord({
    id: 'rec-failed-001',
    taskId: 'gen_old_task',
    status: 'failed',
    inputParams: { prompt: '你好' },
    outputResult: null,
    cost: null,
    errorMessage: 'previous error',
    dedupeKey: 'qwen-max:{"prompt":"你好"}',
    ...overrides,
  })
}

/** 构造 processing 状态的 GenerationRecordRow */
export function makeProcessingRecord(overrides: Partial<GenerationRecordRow> = {}): GenerationRecordRow {
  return makeRecord({
    id: 'rec-proc-001',
    taskId: 'gen_proc_task',
    status: 'processing',
    inputParams: { prompt: 'test' },
    outputResult: {},
    cost: null,
    errorMessage: null,
    dedupeKey: null,
    ...overrides,
  })
}

// ===== UploadedFile 工厂 =====

/** 构造 UploadedFileRow 测试数据 */
export function makeUploadedFile(overrides: Partial<UploadedFileRow> = {}): UploadedFileRow {
  return {
    id: 'file-001',
    accountId: 'acc-test',
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

// ===== ServerConfig 工厂 =====

/**
 * 构造测试用 ServerConfig
 *
 * 默认值适用于大多数 server 测试场景（port=0, 空 DB URL, 1h JWT 过期）。
 * jwtSecret 每个测试文件应使用唯一值以避免签名冲突。
 */
export function makeTestConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  return {
    port: 0,
    databaseUrl: '',
    dashscopeApiKey: '',
    dashscopeBaseUrl: '',
    storageRoot: '',
    frontendUrl: '',
    workerPollIntervalMs: 0,
    jwtSecret: 'test-secret',
    jwtExpiresIn: '1h',
    oss: undefined,
    ...overrides,
  }
}

// ===== JWT 签发辅助 =====

/**
 * 通过独立 JWT 应用签发 token（不依赖 auth 路由）
 *
 * 适用于不需要测试注册/登录流程、只需有效 token 的场景（如 billing 测试）。
 * 返回签发给指定 accountId 的 JWT 字符串。
 */
export async function signTestToken(jwtSecret: string, accountId: string): Promise<string> {
  const { Elysia } = await import('elysia')
  const jwtApp = new Elysia()
    .use((await import('@elysia/jwt')).jwt({ name: 'jwt', secret: jwtSecret, exp: '1h' }))
    .get('/sign', async ({ jwt }) => jwt.sign({ sub: accountId }))

  const { treaty } = await import('@elysia/eden')
  const jwtClient = treaty(jwtApp)
  const { data } = await jwtClient.sign.get()
  return data as unknown as string
}
