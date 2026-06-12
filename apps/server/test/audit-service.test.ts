import { afterEach, describe, expect, it, mock } from 'bun:test'
import { audit, resetAuditWriter, setAuditWriter } from '../src/services/audit'

describe('audit service', () => {
  afterEach(() => {
    resetAuditWriter()
  })

  it('uses an injected writer when explicitly enabled', async () => {
    const writer = mock(() => Promise.resolve())
    setAuditWriter(writer)

    await audit('login', { accountId: 'acc-001', ip: '127.0.0.1' })

    expect(writer).toHaveBeenCalledWith({
      action: 'login',
      accountId: 'acc-001',
      ip: '127.0.0.1',
    })
  })
})
