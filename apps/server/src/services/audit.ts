import type { auditActionEnum } from '@excuse/db'
import { createAuditLog } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('audit')

type AuditAction = typeof auditActionEnum.enumValues[number]

export interface AuditEntry {
  accountId?: string
  action: AuditAction
  targetId?: string
  /** 审计详情 — 非结构化存储边界：不同 action 类型有不同 detail 形状，无法统一 DTO */
  detail?: Record<string, unknown>
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
    detail?: Record<string, unknown>
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
