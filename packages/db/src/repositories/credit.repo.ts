import type { CreditAccountRow, CreditTransactionRow } from '../types'
import { and, desc, eq, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { creditAccounts, creditTransactions, usageEvents } from '../schema'

// ===== Credit Account =====

/**
 * 获取或创建用户信用账户（每用户一行）
 */
export async function getOrCreateCreditAccount(accountId: string): Promise<CreditAccountRow> {
  const existing = await getCreditAccount(accountId)
  if (existing)
    return existing

  const [created] = await getDb().insert(creditAccounts).values({ accountId }).returning()
  return created!
}

/**
 * 获取用户信用账户
 */
export async function getCreditAccount(accountId: string): Promise<CreditAccountRow | null> {
  const [row] = await getDb()
    .select()
    .from(creditAccounts)
    .where(eq(creditAccounts.accountId, accountId))
    .limit(1)
  return row ?? null
}

// ===== Reserve / Debit / Refund =====

/**
 * 预留资金 — 生成开始时冻结预估费用
 *
 * 原子操作：检查余额 → 扣减可用 → 增加冻结 → 写交易流水 → 写使用事件
 * 使用 SQL UPDATE ... WHERE 确保并发安全
 *
 * @throws 余额不足时抛出 Error
 */
export async function reserveCredit(opts: {
  accountId: string
  generationRecordId: string
  amountCents: number
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, amountCents, description } = opts

  // 原子扣减：只有 availableCents >= amountCents 时才更新
  const [updated] = await getDb()
    .update(creditAccounts)
    .set({
      availableCents: sql`${creditAccounts.availableCents} - ${amountCents}`,
      frozenCents: sql`${creditAccounts.frozenCents} + ${amountCents}`,
      updatedAt: new Date(),
    })
    .where(and(
      eq(creditAccounts.accountId, accountId),
      sql`${creditAccounts.availableCents} >= ${amountCents}`,
    ))
    .returning()

  if (!updated) {
    const account = await getCreditAccount(accountId)
    throw new CreditError(
      'INSUFFICIENT_BALANCE',
      `余额不足：需要 ${amountCents} 分，可用 ${account?.availableCents ?? 0} 分`,
    )
  }

  // 写交易流水
  const [tx] = await getDb().insert(creditTransactions).values({
    accountId,
    type: 'reserve',
    amountCents,
    balanceAfterCents: updated.availableCents,
    frozenAfterCents: updated.frozenCents,
    generationRecordId,
    description: description ?? '生成任务预留',
  }).returning()

  // 写使用事件
  await getDb().insert(usageEvents).values({
    accountId,
    generationRecordId,
    reserveTxId: tx!.id,
    reservedCents: amountCents,
  }).onConflictDoNothing()

  return tx!
}

/**
 * 扣款 — 生成成功后从冻结中扣除实际费用
 *
 * 如果实际费用 < 预留金额，差额退还到可用余额
 * 幂等：同一 generationRecordId 只能 debit 一次
 */
export async function debitCredit(opts: {
  accountId: string
  generationRecordId: string
  actualCents: number
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, actualCents, description } = opts

  // 查找 usage event 获取预留金额
  const [event] = await getDb()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.generationRecordId, generationRecordId))
    .limit(1)

  const reservedCents = event?.reservedCents ?? 0
  const refundCents = Math.max(0, reservedCents - actualCents)

  // 原子更新：冻结减少 reservedCents，可用增加 refundCents（差额退还）
  const [updated] = await getDb()
    .update(creditAccounts)
    .set({
      frozenCents: sql`${creditAccounts.frozenCents} - ${reservedCents}`,
      availableCents: sql`${creditAccounts.availableCents} + ${refundCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creditAccounts.accountId, accountId))
    .returning()

  if (!updated) {
    throw new CreditError('ACCOUNT_NOT_FOUND', `账户不存在: ${accountId}`)
  }

  // 写交易流水（幂等：唯一索引防止重复）
  const [tx] = await getDb().insert(creditTransactions).values({
    accountId,
    type: 'debit',
    amountCents: actualCents,
    balanceAfterCents: updated.availableCents,
    frozenAfterCents: updated.frozenCents,
    generationRecordId,
    description: description ?? '生成完成扣款',
  }).returning()

  // 更新 usage event
  if (event) {
    await getDb()
      .update(usageEvents)
      .set({ debitTxId: tx!.id, debitedCents: actualCents, updatedAt: new Date() })
      .where(eq(usageEvents.id, event.id))
  }

  return tx!
}

/**
 * 退还 — 生成失败时全额退还冻结资金
 *
 * 幂等：同一 generationRecordId 只能 refund 一次
 */
export async function refundCredit(opts: {
  accountId: string
  generationRecordId: string
  description?: string
}): Promise<CreditTransactionRow> {
  const { accountId, generationRecordId, description } = opts

  // 查找 usage event 获取预留金额
  const [event] = await getDb()
    .select()
    .from(usageEvents)
    .where(eq(usageEvents.generationRecordId, generationRecordId))
    .limit(1)

  const reservedCents = event?.reservedCents ?? 0

  // 原子更新：冻结减少，可用增加
  const [updated] = await getDb()
    .update(creditAccounts)
    .set({
      frozenCents: sql`${creditAccounts.frozenCents} - ${reservedCents}`,
      availableCents: sql`${creditAccounts.availableCents} + ${reservedCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creditAccounts.accountId, accountId))
    .returning()

  if (!updated) {
    throw new CreditError('ACCOUNT_NOT_FOUND', `账户不存在: ${accountId}`)
  }

  // 写交易流水（幂等）
  const [tx] = await getDb().insert(creditTransactions).values({
    accountId,
    type: 'refund',
    amountCents: reservedCents,
    balanceAfterCents: updated.availableCents,
    frozenAfterCents: updated.frozenCents,
    generationRecordId,
    description: description ?? '生成失败退还',
  }).returning()

  // 更新 usage event
  if (event) {
    await getDb()
      .update(usageEvents)
      .set({ refundTxId: tx!.id, updatedAt: new Date() })
      .where(eq(usageEvents.id, event.id))
  }

  return tx!
}

// ===== Credit (充值) =====

/**
 * 充值 — 增加用户可用余额
 */
export async function creditBalance(opts: {
  accountId: string
  amountCents: number
  description?: string
  metadata?: Record<string, unknown>
}): Promise<CreditTransactionRow> {
  const { accountId, amountCents, description, metadata } = opts

  const [updated] = await getDb()
    .update(creditAccounts)
    .set({
      availableCents: sql`${creditAccounts.availableCents} + ${amountCents}`,
      updatedAt: new Date(),
    })
    .where(eq(creditAccounts.accountId, accountId))
    .returning()

  if (!updated) {
    throw new CreditError('ACCOUNT_NOT_FOUND', `账户不存在: ${accountId}`)
  }

  const [tx] = await getDb().insert(creditTransactions).values({
    accountId,
    type: 'credit',
    amountCents,
    balanceAfterCents: updated.availableCents,
    frozenAfterCents: updated.frozenCents,
    description: description ?? '充值',
    metadata,
  }).returning()

  return tx!
}

// ===== Query =====

/**
 * 查询交易流水
 */
export async function listCreditTransactions(opts: {
  accountId: string
  limit?: number
  offset?: number
}): Promise<CreditTransactionRow[]> {
  const { accountId, limit = 50, offset = 0 } = opts
  return getDb()
    .select()
    .from(creditTransactions)
    .where(eq(creditTransactions.accountId, accountId))
    .orderBy(desc(creditTransactions.createdAt))
    .limit(limit)
    .offset(offset)
}

// ===== Error =====

export class CreditError extends Error {
  readonly code: 'INSUFFICIENT_BALANCE' | 'ACCOUNT_NOT_FOUND' | 'ALREADY_RESERVED'
  constructor(
    code: 'INSUFFICIENT_BALANCE' | 'ACCOUNT_NOT_FOUND' | 'ALREADY_RESERVED',
    message: string,
  ) {
    super(message)
    this.name = 'CreditError'
    this.code = code
  }
}
