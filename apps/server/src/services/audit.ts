import type { auditActionEnum } from '@excuse/db'
import { createAuditLog } from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('audit')

/**
 * 记录审计日志 — 失败时只记录错误不阻塞业务
 */
export async function audit(
  action: typeof auditActionEnum.enumValues[number],
  opts?: {
    accountId?: string
    targetId?: string
    detail?: Record<string, unknown>
    ip?: string
  },
) {
  try {
    await createAuditLog({ action, ...opts })
  }
  catch (err) {
    logger.error({ action, err }, '审计日志写入失败')
  }
}
