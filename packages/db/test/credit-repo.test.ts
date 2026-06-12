import { creditBalance, CreditError, debitCredit, getOrCreateCreditAccount, listCreditTransactions, refundCredit, reserveCredit } from '@excuse/db'
import { describe, expect, it } from 'bun:test'

/**
 * Credit repo 单元测试
 *
 * 实际 Reserve/Debit/Refund 流程需要 PostgreSQL（pgEnum 不支持 SQLite），
 * 这里验证导出、类型和 CreditError 行为。
 * 完整集成测试在 server 的 billing 测试中覆盖。
 */

describe('credit lifecycle', () => {
  it('CreditError 可被构造和捕获', () => {
    const err = new CreditError('INSUFFICIENT_BALANCE', 'not enough')
    expect(err.code).toBe('INSUFFICIENT_BALANCE')
    expect(err.message).toBe('not enough')
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(CreditError)
  })

  it('getOrCreateCreditAccount 导出为函数', () => {
    expect(typeof getOrCreateCreditAccount).toBe('function')
  })

  it('reserveCredit 导出为函数', () => {
    expect(typeof reserveCredit).toBe('function')
  })

  it('debitCredit 导出为函数', () => {
    expect(typeof debitCredit).toBe('function')
  })

  it('refundCredit 导出为函数', () => {
    expect(typeof refundCredit).toBe('function')
  })

  it('creditBalance 导出为函数', () => {
    expect(typeof creditBalance).toBe('function')
  })

  it('listCreditTransactions 导出为函数', () => {
    expect(typeof listCreditTransactions).toBe('function')
  })
})
