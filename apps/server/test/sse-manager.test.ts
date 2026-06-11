import { afterEach, describe, expect, it, mock } from 'bun:test'

// Mock @excuse/db before importing sse-manager (it imports pgClient from @excuse/db)
mock.module('@excuse/db', () => ({
  pgClient: { listen: async () => {} },
  notifyGenerationStatus: async () => {},
  markGenerationFailed: async () => {},
  markGenerationProcessing: async () => {},
  markGenerationSucceeded: async () => {},
}))

const { addConnection, dispatchToUser, getOnlineUserCount, removeConnection } = await import('../src/services/sse-manager')

// 追踪所有测试中添加的连接，确保 afterEach 清理干净
const addedConnections: Array<{ userId: string, sender: () => void }> = []

function trackedAdd(userId: string, sender: () => void) {
  addConnection(userId, sender)
  addedConnections.push({ userId, sender })
}

afterEach(() => {
  for (const { userId, sender } of addedConnections) {
    removeConnection(userId, sender)
  }
  addedConnections.length = 0
})

describe('SSE Manager — connection lifecycle', () => {
  it('adds a connection for a user', () => {
    const sender = () => {}
    trackedAdd('user-1', sender)
    expect(getOnlineUserCount()).toBe(1)
  })

  it('supports multiple connections for same user', () => {
    const sender1 = () => {}
    const sender2 = () => {}
    trackedAdd('user-1', sender1)
    trackedAdd('user-1', sender2)
    expect(getOnlineUserCount()).toBe(1) // same user
  })

  it('removes user entry when last connection is removed', () => {
    const sender1 = () => {}
    const sender2 = () => {}
    trackedAdd('user-1', sender1)
    trackedAdd('user-1', sender2)
    removeConnection('user-1', sender1)
    expect(getOnlineUserCount()).toBe(1)
    removeConnection('user-1', sender2)
    expect(getOnlineUserCount()).toBe(0)
    // 防止 afterEach 再次移除已删除的连接
    addedConnections.length = 0
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

    trackedAdd('user-dispatch', sender1)
    trackedAdd('user-dispatch', sender2)

    dispatchToUser('user-dispatch', 'test_event', { msg: 'hello' })

    expect(received).toEqual([
      { event: 'test_event', data: { msg: 'hello' } },
      { event: 'test_event', data: { msg: 'hello' } },
    ])
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

    trackedAdd('user-error', badSender)
    trackedAdd('user-error', goodSender)

    // Should not throw, and good sender should still be called
    expect(() => dispatchToUser('user-error', 'test', {})).not.toThrow()
    expect(received).toBe(true)
  })
})
