import { eq } from 'drizzle-orm'
import { uploadedFiles } from '../schema'
import { getDb } from '../db'
import type { UploadedFileInsert } from '../types'

/**
 * 创建上传文件记录
 */
export async function createUploadedFile(values: UploadedFileInsert) {
  const [record] = await getDb().insert(uploadedFiles).values(values).returning()
  return record!
}

/**
 * 按 ID 查询单条上传文件记录
 */
export async function getUploadedFileById(id: string) {
  const [record] = await getDb()
    .select()
    .from(uploadedFiles)
    .where(eq(uploadedFiles.id, id))
    .limit(1)
  return record ?? null
}
