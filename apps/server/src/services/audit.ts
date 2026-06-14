import type { auditActionEnum, AuditDetail } from '@excuse/db'
import { createAuditLog } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('audit')

type AuditAction = typeof auditActionEnum.enumValues[number]

export interface AuditEntry {
  accountId?: string
  action: AuditAction
  targetId?: string
  /** 审计详情 — 结构化 AuditDetail DTO，每种 action 有对应形状 */
  detail?: AuditDetail
  ip?: string
}

export type AuditWriter = (entry: AuditEntry) => Promise<void>

let auditWriter: AuditWriter = createAuditLog
let auditEnabled = Bun.env.NODE_ENV !== 'test'

export function setAuditWriter(writer: AuditWriter): void {
  auditWriter = writer
  auditEnabled = true
}

export function resetAuditWriter(): void {
  auditWriter = createAuditLog
  auditEnabled = Bun.env.NODE_ENV !== 'test'
}

/**
 * 记录审计日志 — 失败时只记录错误不阻塞业务
 */
export async function audit(
  action: AuditAction,
  opts?: {
    accountId?: string
    targetId?: string
    detail?: AuditDetail
    ip?: string
  },
) {
  if (!auditEnabled)
    return

  try {
    await auditWriter({ action, ...opts })
  }
  catch (err) {
    logger.error({ action, err }, '审计日志写入失败')
  }
}
