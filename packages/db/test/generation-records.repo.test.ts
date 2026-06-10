import { describe, it, expect, beforeEach } from 'bun:test'
import { setDb } from '../src/db'
import { createMockDb } from './helpers/mock-db'
import {
  createGenerationRecord,
  getGenerationRecordById,
  listGenerationRecords,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  pollPendingVideoTasks,
  getCostRecords,
} from '../src/repositories/generation-records.repo'

describe('generation-records repository', () => {
  let mock: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mock = createMockDb()
    setDb(mock.db as any)
  })

  // ─── createGenerationRecord ───────────────────────────

  describe('createGenerationRecord', () => {
    it('should insert and return the record', async () => {
      const fakeRecord = { id: 'rec-1', taskId: 'task-1', status: 'pending' }
      mock.setInsertResult([fakeRecord])

      const result = await createGenerationRecord({
        accountId: '00000000-0000-0000-0000-000000000000',
        taskId: 'task-1',
        model: 'qwen-vl',
        category: 'text',
        status: 'pending',
        inputParams: {},
      })

      expect(result).toEqual(fakeRecord)
    })
  })

  // ─── getGenerationRecordById ───────────────────────────

  describe('getGenerationRecordById', () => {
    it('should return the record when found', async () => {
      const fakeRecord = { id: 'rec-1', status: 'succeeded' }
      mock.setSelectResult([fakeRecord])

      const result = await getGenerationRecordById('rec-1')

      expect(result).toEqual(fakeRecord)
    })

    it('should return null when not found', async () => {
      mock.setSelectResult([])

      const result = await getGenerationRecordById('nonexistent')

      expect(result).toBeNull()
    })
  })

  // ─── listGenerationRecords ─────────────────────────────

  describe('listGenerationRecords', () => {
    it('should return records with default pagination', async () => {
      const fakeRecords = [{ id: '1' }, { id: '2' }]
      mock.setSelectResult(fakeRecords)

      const result = await listGenerationRecords()

      expect(result).toEqual(fakeRecords)
    })

    it('should pass filter options through', async () => {
      const fakeRecords = [{ id: '1', category: 'image', status: 'succeeded' }]
      mock.setSelectResult(fakeRecords)

      const result = await listGenerationRecords({
        category: 'image',
        status: 'succeeded',
        limit: 10,
        offset: 5,
      })

      expect(result).toEqual(fakeRecords)
    })

    it('should return empty array when no records match', async () => {
      mock.setSelectResult([])

      const result = await listGenerationRecords({ category: 'audio' })

      expect(result).toEqual([])
    })
  })

  // ─── markGenerationFailed ──────────────────────────────

  describe('markGenerationFailed', () => {
    it('should resolve without error', async () => {
      await expect(
        markGenerationFailed('rec-1', 'Something went wrong'),
      ).resolves.toBeUndefined()
    })
  })

  // ─── markGenerationProcessing ──────────────────────────

  describe('markGenerationProcessing', () => {
    it('should resolve without extra fields', async () => {
      await expect(
        markGenerationProcessing('rec-1'),
      ).resolves.toBeUndefined()
    })

    it('should resolve with taskId and outputResult', async () => {
      await expect(
        markGenerationProcessing('rec-1', {
          taskId: 'provider-123',
          outputResult: { url: 'test.mp4' },
        }),
      ).resolves.toBeUndefined()
    })
  })

  // ─── markGenerationSucceeded ───────────────────────────

  describe('markGenerationSucceeded', () => {
    it('should resolve with output and cost', async () => {
      await expect(
        markGenerationSucceeded('rec-1', { url: 'result.png' }, { totalPrice: 0.01 }),
      ).resolves.toBeUndefined()
    })

    it('should resolve without cost', async () => {
      await expect(
        markGenerationSucceeded('rec-1', { text: 'hello' }),
      ).resolves.toBeUndefined()
    })
  })

  // ─── pollPendingVideoTasks ─────────────────────────────

  describe('pollPendingVideoTasks', () => {
    it('should return pending/processing video tasks', async () => {
      const fakeTasks = [
        { id: '1', status: 'pending', category: 'video' },
        { id: '2', status: 'processing', category: 'video' },
      ]
      mock.setSelectResult(fakeTasks)

      const result = await pollPendingVideoTasks()

      expect(result).toEqual(fakeTasks)
    })

    it('should return empty array when no tasks', async () => {
      mock.setSelectResult([])

      const result = await pollPendingVideoTasks()

      expect(result).toEqual([])
    })
  })

  // ─── getCostRecords ────────────────────────────────────

  describe('getCostRecords', () => {
    it('should filter records with valid totalPrice', async () => {
      mock.setSelectResult([
        { model: 'qwen', category: 'text', cost: { totalPrice: 0.01 }, createdAt: new Date() },
        { model: 'wanx', category: 'image', cost: { totalPrice: 0.05 }, createdAt: new Date() },
        { model: 'qwen', category: 'text', cost: { estimated: true }, createdAt: new Date() },
        { model: 'qwen', category: 'text', cost: null, createdAt: new Date() },
      ])

      const result = await getCostRecords()

      expect(result).toHaveLength(2)
      expect(result[0].cost.totalPrice).toBe(0.01)
      expect(result[1].cost.totalPrice).toBe(0.05)
    })

    it('should return empty array when no cost records exist', async () => {
      mock.setSelectResult([])

      const result = await getCostRecords()

      expect(result).toEqual([])
    })

    it('should exclude records where totalPrice is not a number', async () => {
      mock.setSelectResult([
        { model: 'qwen', category: 'text', cost: { totalPrice: 'free' }, createdAt: new Date() },
        { model: 'qwen', category: 'text', cost: { totalPrice: undefined }, createdAt: new Date() },
      ])

      const result = await getCostRecords()

      expect(result).toHaveLength(0)
    })
  })
})
