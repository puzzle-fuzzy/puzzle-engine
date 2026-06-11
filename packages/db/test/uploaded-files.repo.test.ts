import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createUploadedFile,
  getUploadedFileById,
} from '../src/repositories/uploaded-files.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('uploaded-files repository', () => {
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

  function validFileInsert(overrides: Record<string, unknown> = {}) {
    return {
      accountId,
      fileName: 'photo.png',
      fileSize: 1024,
      mimeType: 'image/png',
      storagePath: '/data/uploads/photo.png',
      publicUrl: '/uploads/photo.png',
      purpose: 'reference',
      ...overrides,
    }
  }

  // ─── createUploadedFile ────────────────────────────────

  describe('createUploadedFile', () => {
    it('should insert and return the file record', async () => {
      const result = await createUploadedFile(validFileInsert())

      expect(result.id).toBeDefined()
      expect(result.accountId).toBe(accountId)
      expect(result.fileName).toBe('photo.png')
      expect(result.fileSize).toBe(1024)
      expect(result.mimeType).toBe('image/png')
      expect(result.purpose).toBe('reference')
      expect(result.createdAt).toBeInstanceOf(Date)
    })
  })

  // ─── getUploadedFileById ───────────────────────────────

  describe('getUploadedFileById', () => {
    it('should return the file record when found', async () => {
      const created = await createUploadedFile(validFileInsert())
      const found = await getUploadedFileById(created.id)

      expect(found).not.toBeNull()
      expect(found!.id).toBe(created.id)
      expect(found!.fileName).toBe('photo.png')
    })

    it('should return null for nonexistent ID', async () => {
      const result = await getUploadedFileById('00000000-0000-0000-0000-000000000000')
      expect(result).toBeNull()
    })
  })

  // ─── 约束验证 ─────────────────────────────────────────

  describe('constraints', () => {
    it('should reject invalid accountId (FK constraint)', async () => {
      await expect(
        createUploadedFile(validFileInsert({ accountId: '00000000-0000-0000-0000-000000000000' })),
      ).rejects.toThrow()
    })
  })
})
