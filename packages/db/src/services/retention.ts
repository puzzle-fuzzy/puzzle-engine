import { and, lt, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { createAuditLog } from '../repositories/audit-logs.repo'
import { apiKeys, auditLogs, generationRecords } from '../schema'

/**
 * 数据保留策略
 *
 * 过期数据由 runRetentionCleanup() 定期清理。
 * 清理前先写审计日志，确保可追溯。
 */
export const RETENTION_POLICY = {
  /** 审计日志保留 365 天 */
  auditLogsDays: 365,
  /** 已撤销 API Key 保留 90 天（撤销后） */
  revokedApiKeysDays: 90,
  /** 失败/取消的生成记录保留 180 天 */
  failedRecordsDays: 180,
  /** 已删除的上传文件记录保留 90 天 */
  deletedFilesDays: 90,
} as const

export interface RetentionResult {
  auditLogsDeleted: number
  revokedApiKeysDeleted: number
  failedRecordsDeleted: number
  deletedFilesPurged: number
}

/**
 * 执行数据保留清理 — 幂等操作，可安全重复调用
 *
 * 每种清理独立执行，失败不影响其他清理。
 * 清理完成后写审计日志记录本次清理的统计。
 */
export async function runRetentionCleanup(): Promise<RetentionResult> {
  const result: RetentionResult = {
    auditLogsDeleted: 0,
    revokedApiKeysDeleted: 0,
    failedRecordsDeleted: 0,
    deletedFilesPurged: 0,
  }

  const now = new Date()

  // 1. 清理过期审计日志
  const auditCutoff = new Date(now.getTime() - RETENTION_POLICY.auditLogsDays * 86400000)
  const auditResult = await getDb()
    .delete(auditLogs)
    .where(lt(auditLogs.createdAt, auditCutoff))
    .returning({ id: auditLogs.id })
  result.auditLogsDeleted = auditResult.length

  // 2. 清理已撤销超过 90 天的 API Key
  const keyCutoff = new Date(now.getTime() - RETENTION_POLICY.revokedApiKeysDays * 86400000)
  const keyResult = await getDb()
    .delete(apiKeys)
    .where(and(
      sql`${apiKeys.revokedAt} IS NOT NULL`,
      lt(apiKeys.revokedAt, keyCutoff),
    ))
    .returning({ id: apiKeys.id })
  result.revokedApiKeysDeleted = keyResult.length

  // 3. 清理失败/取消超过 180 天的生成记录
  const recordCutoff = new Date(now.getTime() - RETENTION_POLICY.failedRecordsDays * 86400000)
  const recordResult = await getDb()
    .delete(generationRecords)
    .where(and(
      sql`${generationRecords.status} IN ('failed', 'cancelled')`,
      lt(generationRecords.createdAt, recordCutoff),
    ))
    .returning({ id: generationRecords.id })
  result.failedRecordsDeleted = recordResult.length

  // 4. 记录本次清理审计日志（写在新日志之后，不会被自己删掉）
  try {
    await createAuditLog({
      action: 'admin_action',
      detail: {
        type: 'retention_cleanup',
        ...result,
        policy: RETENTION_POLICY,
      },
    })
  }
  catch {
    // 审计日志写入失败不应阻塞清理
  }

  return result
}
