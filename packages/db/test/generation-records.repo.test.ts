import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createGenerationRecord,
  getCostRecords,
  getGenerationRecordById,
  listGenerationRecords,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  pollPendingVideoTasks,
} from '../src/repositories/generation-records.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('generation-records repository', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  // ─── 辅助：构造合法插入数据 ────────────────────────────

  function validInsert(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      model: 'qwen-vl',
      category: 'text' as const,
      status: 'pending' as const,
      inputParams: { prompt: 'test prompt' },
      ...overrides,
    }
  }

  // ─── createGenerationRecord ───────────────────────────

  describe('createGenerationRecord', () => {
    it('should insert and return a record with all fields', async () => {
      const result = await createGenerationRecord(validInsert({
        taskId: 'task-001',
      }))

      expect(result.id).toBeDefined()
      expect(result.accountId).toBe(accountId)
      expect(result.model).toBe('qwen-vl')
      expect(result.category).toBe('text')
      expect(result.status).toBe('pending')
      expect(result.inputParams).toEqual({ prompt: 'test prompt' })
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ─── getGenerationRecordById ───────────────────────────

  describe('getGenerationRecordById', () => {
    it('should return the record when found', async () => {
      const created = await createGenerationRecord(validInsert())
      const found = await getGenerationRecordById(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.model).toBe('qwen-vl')
    })

    it('should return null for nonexistent ID', async () => {
      const result = await getGenerationRecordById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── listGenerationRecords ─────────────────────────────

  describe('listGenerationRecords', () => {
    it('should return records ordered by createdAt desc', async () => {
      await createGenerationRecord(validInsert({ category: 'image' }))
      await createGenerationRecord(validInsert({ category: 'text' }))

      const results = await listGenerationRecords()
      expect(results.length).toBeGreaterThanOrEqual(2)
      // 最新的排在前面
      expect(results[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        results[1].createdAt.getTime(),
      )
    })

    it('should filter by category', async () => {
      await createGenerationRecord(validInsert({ category: 'image' }))
      await createGenerationRecord(validInsert({ category: 'text' }))

      const images = await listGenerationRecords({ category: 'image' })
      expect(images.length).toBeGreaterThanOrEqual(1)
      expect(images.every(r => r.category === 'image')).toBe(true)
    })

    it('should filter by status', async () => {
      await createGenerationRecord(validInsert({ status: 'pending' }))

      const pending = await listGenerationRecords({ status: 'pending' })
      expect(pending.length).toBeGreaterThanOrEqual(1)
      expect(pending.every(r => r.status === 'pending')).toBe(true)
    })

    it('should respect limit and offset', async () => {
      // 创建 3 条记录
      for (let i = 0; i < 3; i++) {
        await createGenerationRecord(validInsert())
      }

      const page1 = await listGenerationRecords({ limit: 2, offset: 0 })
      const page2 = await listGenerationRecords({ limit: 2, offset: 2 })

      expect(page1).toHaveLength(2)
      expect(page2).toHaveLength(1)
    })

    it('should return empty array when no records match filter', async () => {
      const results = await listGenerationRecords({ category: 'audio' })
      expect(results).toHaveLength(0)
    })
  })

  // ─── markGenerationFailed ──────────────────────────────

  describe('markGenerationFailed', () => {
    it('should update status to failed and set error message', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationFailed(record.id, 'Out of credits')

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('failed')
      expect(updated!.errorMessage).toBe('Out of credits')
    })
  })

  // ─── markGenerationProcessing ──────────────────────────

  describe('markGenerationProcessing', () => {
    it('should update status to processing', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationProcessing(record.id)

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('processing')
    })

    it('should set taskId and outputResult when provided', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationProcessing(record.id, {
        taskId: 'provider-123',
        outputResult: { url: 'test.mp4' },
      })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('processing')
      expect(updated!.taskId).toBe('provider-123')
      expect(updated!.outputResult).toEqual({ url: 'test.mp4' })
    })
  })

  // ─── markGenerationSucceeded ───────────────────────────

  describe('markGenerationSucceeded', () => {
    it('should update status and set output and cost', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(record.id, { url: 'result.png' }, { totalPrice: 0.01 })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('succeeded')
      expect(updated!.outputResult).toEqual({ url: 'result.png' })
      expect((updated!.cost as any).totalPrice).toBe(0.01)
    })

    it('should succeed without cost', async () => {
      const record = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(record.id, { text: 'hello' })

      const updated = await getGenerationRecordById(record.id)
      expect(updated!.status).toBe('succeeded')
      expect(updated!.cost).toBeNull()
    })
  })

  // ─── pollPendingVideoTasks ─────────────────────────────

  describe('pollPendingVideoTasks', () => {
    it('should return pending and processing video tasks only', async () => {
      await createGenerationRecord(validInsert({ category: 'video', status: 'pending' }))
      await createGenerationRecord(validInsert({ category: 'video', status: 'processing' }))
      // 非视频任务，不应返回
      await createGenerationRecord(validInsert({ category: 'text', status: 'pending' }))

      const tasks = await pollPendingVideoTasks()
      expect(tasks.length).toBe(2)
      expect(tasks.every(t => t.category === 'video')).toBe(true)
      expect(tasks.every(t => ['pending', 'processing'].includes(t.status))).toBe(true)
    })

    it('should return empty array when no video tasks', async () => {
      await createGenerationRecord(validInsert({ category: 'text' }))

      const tasks = await pollPendingVideoTasks()
      expect(tasks).toHaveLength(0)
    })
  })

  // ─── getCostRecords ────────────────────────────────────

  describe('getCostRecords', () => {
    it('should return only records with numeric totalPrice in cost', async () => {
      const r1 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r1.id, { url: 'a.png' }, { totalPrice: 0.01 })

      const r2 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r2.id, { url: 'b.png' }, { totalPrice: 0.05 })

      // 成功但无 cost
      const r3 = await createGenerationRecord(validInsert())
      await markGenerationSucceeded(r3.id, { url: 'c.png' })

      const costs = await getCostRecords()
      const testCosts = costs.filter(c => c.model === 'qwen-vl')
      expect(testCosts.length).toBeGreaterThanOrEqual(2)
      testCosts.forEach((c) => {
        expect(typeof (c.cost as any).totalPrice).toBe('number')
      })
    })

    it('should return empty when no cost records exist', async () => {
      await createGenerationRecord(validInsert({ status: 'pending' }))

      const costs = await getCostRecords()
      const testCosts = costs.filter(c => c.model === 'qwen-vl')
      expect(testCosts).toHaveLength(0)
    })
  })

  // ─── 约束验证 ─────────────────────────────────────────

  describe('constraints', () => {
    it('should reject duplicate taskId (unique constraint)', async () => {
      await createGenerationRecord(validInsert({ taskId: 'unique-task-001' }))

      await expect(
        createGenerationRecord(validInsert({ taskId: 'unique-task-001' })),
      ).rejects.toThrow()
    })

    it('should reject invalid accountId (FK constraint)', async () => {
      await expect(
        createGenerationRecord(validInsert({ accountId: '00000000-0000-0000-0000-000000000000' })),
      ).rejects.toThrow()
    })
  })
})
