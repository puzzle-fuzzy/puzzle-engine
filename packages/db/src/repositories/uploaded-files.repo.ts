import type { UploadedFileInsert } from '../types'
import { and, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { uploadedFiles } from '../schema'

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

/**
 * 按 ID 列表批量查询上传文件记录
 */
export async function getUploadedFilesByIds(ids: string[]) {
  if (ids.length === 0)
    return []
  return getDb()
    .select()
    .from(uploadedFiles)
    .where(inArray(uploadedFiles.id, ids))
}

/**
 * 按 ID 列表批量查询属于指定用户的上传文件记录
 */
export async function getUploadedFilesByIdsForAccount(ids: string[], accountId: string) {
  if (ids.length === 0)
    return []
  return getDb()
    .select()
    .from(uploadedFiles)
    .where(and(inArray(uploadedFiles.id, ids), eq(uploadedFiles.accountId, accountId)))
}

export async function deleteUploadedFileById(id: string) {
  await getDb().delete(uploadedFiles).where(eq(uploadedFiles.id, id))
}
