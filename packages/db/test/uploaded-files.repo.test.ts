import { describe, it, expect, beforeEach } from 'bun:test'
import { setDb } from '../src/db'
import { createMockDb } from './helpers/mock-db'
import {
  createUploadedFile,
  getUploadedFileById,
} from '../src/repositories/uploaded-files.repo'

describe('uploaded-files repository', () => {
  let mock: ReturnType<typeof createMockDb>

  beforeEach(() => {
    mock = createMockDb()
    setDb(mock.db as any)
  })

  // ─── createUploadedFile ────────────────────────────────

  describe('createUploadedFile', () => {
    it('should insert and return the file record', async () => {
      const fakeRecord = {
        id: 'file-1',
        fileName: 'photo.png',
        publicUrl: '/uploads/photo.png',
        mimeType: 'image/png',
      }
      mock.setInsertResult([fakeRecord])

      const result = await createUploadedFile({
        accountId: '00000000-0000-0000-0000-000000000000',
        fileName: 'photo.png',
        fileSize: 1024,
        mimeType: 'image/png',
        storagePath: '/data/uploads/ref_123/photo.png',
        publicUrl: '/uploads/photo.png',
        purpose: 'reference',
      })

      expect(result).toEqual(fakeRecord)
    })
  })

  // ─── getUploadedFileById ───────────────────────────────

  describe('getUploadedFileById', () => {
    it('should return the file record when found', async () => {
      const fakeRecord = { id: 'file-1', fileName: 'photo.png' }
      mock.setSelectResult([fakeRecord])

      const result = await getUploadedFileById('file-1')

      expect(result).toEqual(fakeRecord)
    })

    it('should return null when not found', async () => {
      mock.setSelectResult([])

      const result = await getUploadedFileById('nonexistent')

      expect(result).toBeNull()
    })
  })
})
