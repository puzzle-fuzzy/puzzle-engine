import { eq, desc, and, inArray, isNotNull } from 'drizzle-orm'
import { generationRecords } from '../schema'
import { getDb } from '../db'
import type { ListGenerationRecordsFilter, GenerationRecordInsert } from '../types'

/**
 * 创建生成记录
 */
export async function createGenerationRecord(values: GenerationRecordInsert) {
  const [record] = await getDb().insert(generationRecords).values(values).returning()
  return record!
}

/**
 * 按 ID 查询单条生成记录
 */
export async function getGenerationRecordById(id: string) {
  const [record] = await getDb()
    .select()
    .from(generationRecords)
    .where(eq(generationRecords.id, id))
    .limit(1)
  return record ?? null
}

/**
 * 分页查询生成记录，category/status 过滤推到 SQL 层
 */
export async function listGenerationRecords(filter: ListGenerationRecordsFilter = {}) {
  const { accountId, category, status, limit = 50, offset = 0 } = filter

  const conditions = []
  if (accountId) conditions.push(eq(generationRecords.accountId, accountId))
  if (category) conditions.push(eq(generationRecords.category, category))
  if (status) conditions.push(eq(generationRecords.status, status))

  return getDb()
    .select()
    .from(generationRecords)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(generationRecords.createdAt))
    .limit(limit)
    .offset(offset)
}

/**
 * 标记生成记录为失败
 */
export async function markGenerationFailed(id: string, errorMessage: string) {
  await getDb()
    .update(generationRecords)
    .set({ status: 'failed', errorMessage, updatedAt: new Date() })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为处理中
 */
export async function markGenerationProcessing(
  id: string,
  extra?: { taskId?: string; outputResult?: Record<string, unknown> },
) {
  await getDb()
    .update(generationRecords)
    .set({
      status: 'processing',
      ...(extra?.taskId && { taskId: extra.taskId }),
      ...(extra?.outputResult && { outputResult: extra.outputResult }),
      updatedAt: new Date(),
    })
    .where(eq(generationRecords.id, id))
}

/**
 * 标记生成记录为成功
 */
export async function markGenerationSucceeded(
  id: string,
  outputResult: Record<string, unknown>,
  cost?: Record<string, unknown>,
) {
  await getDb()
    .update(generationRecords)
    .set({
      status: 'succeeded',
      outputResult,
      ...(cost && { cost }),
      updatedAt: new Date(),
    })
    .where(eq(generationRecords.id, id))
}

/**
 * 轮询所有待处理的视频任务（Worker 专用）
 */
export async function pollPendingVideoTasks() {
  return getDb()
    .select()
    .from(generationRecords)
    .where(
      and(
        inArray(generationRecords.status, ['pending', 'processing']),
        eq(generationRecords.category, 'video'),
      ),
    )
}

/**
 * 获取含费用信息的记录，用于账单统计
 * 返回所有 cost 不为 NULL 的记录
 */
export async function getCostRecords() {
  const records = await getDb()
    .select({
      model: generationRecords.model,
      category: generationRecords.category,
      cost: generationRecords.cost,
      createdAt: generationRecords.createdAt,
    })
    .from(generationRecords)
    .where(isNotNull(generationRecords.cost))

  // 过滤出有 totalPrice 的记录（JSONB 内部无法直接 SQL 过滤）
  return records.filter(r => r.cost && typeof (r.cost as any).totalPrice === 'number')
}
