import { describe, expect, it, mock } from 'bun:test'

// Mock @excuse/db before importing sse-manager (it imports pgClient from @excuse/db)
mock.module('@excuse/db', () => ({
  pgClient: { listen: async () => {} },
  notifyGenerationStatus: async () => {},
  markGenerationFailed: async () => {},
  markGenerationProcessing: async () => {},
  markGenerationSucceeded: async () => {},
}))

const { addConnection, dispatchToUser, getOnlineUserCount, removeConnection } = await import('../src/services/sse-manager')

describe('SSE Manager — connection lifecycle', () => {
  it('adds a connection for a user', () => {
    const sender = () => {}
    addConnection('user-1', sender)
    expect(getOnlineUserCount()).toBe(1)
    removeConnection('user-1', sender)
  })

  it('supports multiple connections for same user', () => {
    const sender1 = () => {}
    const sender2 = () => {}
    addConnection('user-1', sender1)
    addConnection('user-1', sender2)
    expect(getOnlineUserCount()).toBe(1) // same user
    removeConnection('user-1', sender1)
    removeConnection('user-1', sender2)
  })

  it('removes user entry when last connection is removed', () => {
    const sender1 = () => {}
    const sender2 = () => {}
    addConnection('user-1', sender1)
    addConnection('user-1', sender2)
    removeConnection('user-1', sender1)
    expect(getOnlineUserCount()).toBe(1)
    removeConnection('user-1', sender2)
    expect(getOnlineUserCount()).toBe(0)
  })

  it('removeConnection is no-op for non-existent user', () => {
    expect(() => removeConnection('nobody', () => {})).not.toThrow()
  })
})

describe('SSE Manager — dispatchToUser', () => {
  it('dispatches to all connections of a user', () => {
    const received: Array<{ event: string, data: unknown }> = []
    const sender1 = (event: string, data: unknown) => received.push({ event, data })
    const sender2 = (event: string, data: unknown) => received.push({ event, data })

    addConnection('user-dispatch', sender1)
    addConnection('user-dispatch', sender2)

    dispatchToUser('user-dispatch', 'test_event', { msg: 'hello' })

    expect(received).toEqual([
      { event: 'test_event', data: { msg: 'hello' } },
      { event: 'test_event', data: { msg: 'hello' } },
    ])

    removeConnection('user-dispatch', sender1)
    removeConnection('user-dispatch', sender2)
  })

  it('is no-op when user has no connections', () => {
    expect(() => dispatchToUser('nobody', 'test', {})).not.toThrow()
  })

  it('one failing sender does not block others', () => {
    let received = false
    const badSender = () => {
      throw new Error('boom')
    }
    const goodSender = () => {
      received = true
    }

    addConnection('user-error', badSender)
    addConnection('user-error', goodSender)

    // Should not throw, and good sender should still be called
    expect(() => dispatchToUser('user-error', 'test', {})).not.toThrow()
    expect(received).toBe(true)

    removeConnection('user-error', badSender)
    removeConnection('user-error', goodSender)
  })
})
