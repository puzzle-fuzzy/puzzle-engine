import { describe, expect, it } from 'bun:test'
import {
  createGenerationNotifyDispatcher,
  createNotificationDispatcher,
  GENERATION_STATUS_CHANNEL,
  mapGenerationNotifyToSSEEvents,
  mapNotificationNotifyToSSEEvent,
  NOTIFICATION_CHANNEL,
  parseGenerationNotifyPayload,
  parseNotificationNotifyPayload,
  SSE_GENERATION_STATUS_EVENT,
  SSE_NOTIFICATION_EVENT,
  SSE_PIPELINE_NODE_EVENT,
  UserEventHub,
} from '../src'

describe('@excuse/events', () => {
  it('parses generation notify JSON payload', () => {
    const payload = parseGenerationNotifyPayload(JSON.stringify({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
    }))

    expect(payload.accountId).toBe('acc-1')
    expect(GENERATION_STATUS_CHANNEL).toBe('generation_status')
  })

  it('maps generation notify payload to user SSE event', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      traceId: 'trace-1',
      status: 'succeeded',
      category: 'video',
      model: 'wan',
    })

    expect(events).toEqual([
      {
        userId: 'acc-1',
        event: SSE_GENERATION_STATUS_EVENT,
        data: {
          id: 'rec-1',
          taskId: 'task-1',
          traceId: 'trace-1',
          status: 'succeeded',
          category: 'video',
          model: 'wan',
        },
      },
    ])
  })

  it('adds canvas pipeline events when canvas metadata exists', () => {
    const events = mapGenerationNotifyToSSEEvents({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      status: 'failed',
      category: 'video',
      model: 'wan',
      canvasMeta: {
        projectId: 'project-1',
        shotId: 'shot-1',
        projectStatus: 'failed',
      },
    })

    expect(events.map(event => event.event)).toEqual([
      SSE_GENERATION_STATUS_EVENT,
      SSE_PIPELINE_NODE_EVENT,
      SSE_PIPELINE_NODE_EVENT,
    ])
    expect(events[1]!.data).toMatchObject({
      projectId: 'project-1',
      nodeType: 'shot',
      nodeId: 'shot-1',
      status: 'failed',
    })
  })

  it('tracks user event hub connections and dispatches to all tabs', () => {
    const hub = new UserEventHub()
    const received: Array<{ event: string, data: unknown }> = []
    const first = (event: string, data: unknown) => received.push({ event, data })
    const second = (event: string, data: unknown) => received.push({ event, data })

    expect(hub.addConnection('user-1', first)).toBe(1)
    expect(hub.addConnection('user-1', second)).toBe(2)
    expect(hub.getOnlineUserCount()).toBe(1)
    expect(hub.getConnectionCount('user-1')).toBe(2)

    expect(hub.dispatchToUser('user-1', 'hello', { ok: true })).toBe(2)
    expect(received).toEqual([
      { event: 'hello', data: { ok: true } },
      { event: 'hello', data: { ok: true } },
    ])

    expect(hub.removeConnection('user-1', first)).toBe(1)
    expect(hub.removeConnection('user-1', second)).toBe(0)
    expect(hub.getOnlineUserCount()).toBe(0)
  })

  it('continues dispatching when one sender throws', () => {
    const hub = new UserEventHub()
    const errors: unknown[] = []
    const received: string[] = []
    hub.addConnection('user-1', () => {
      throw new Error('broken connection')
    })
    hub.addConnection('user-1', event => received.push(event))

    expect(hub.dispatchToUser('user-1', 'hello', {}, error => errors.push(error))).toBe(1)
    expect(errors).toHaveLength(1)
    expect(received).toEqual(['hello'])
  })

  it('dispatches generation NOTIFY payloads through the provided transport', () => {
    const dispatched: Array<{ userId: string, event: string, data: unknown }> = []
    const handleNotify = createGenerationNotifyDispatcher({
      dispatchToUser: (userId, event, data) => dispatched.push({ userId, event, data }),
    })

    const result = handleNotify(JSON.stringify({
      accountId: 'acc-1',
      recordId: 'rec-1',
      taskId: 'task-1',
      traceId: 'trace-1',
      status: 'succeeded',
      category: 'text',
      model: 'qwen-max',
    }))

    expect(result?.payload.accountId).toBe('acc-1')
    expect(result?.events).toHaveLength(1)
    expect(dispatched).toEqual([
      {
        userId: 'acc-1',
        event: SSE_GENERATION_STATUS_EVENT,
        data: {
          id: 'rec-1',
          taskId: 'task-1',
          traceId: 'trace-1',
          status: 'succeeded',
          category: 'text',
          model: 'qwen-max',
        },
      },
    ])
  })

  it('reports invalid NOTIFY payloads without dispatching', () => {
    const errors: Array<{ error: unknown, rawPayload: string }> = []
    const handleNotify = createGenerationNotifyDispatcher({
      dispatchToUser: () => {
        throw new Error('should not dispatch')
      },
      onError: (error, rawPayload) => errors.push({ error, rawPayload }),
    })

    expect(handleNotify('{bad json')).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.rawPayload).toBe('{bad json')
  })

  // ===== Notification channel（P2-2） =====

  it('exposes the notification channel name', () => {
    expect(NOTIFICATION_CHANNEL).toBe('notification')
    expect(SSE_NOTIFICATION_EVENT).toBe('notification')
  })

  it('parses notification notify JSON payload', () => {
    const payload = parseNotificationNotifyPayload(JSON.stringify({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'task_completed',
      title: '视频生成完成',
      body: 'wan · 点击查看',
      meta: { recordId: 'rec-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    }))

    expect(payload.id).toBe('n-1')
    expect(payload.accountId).toBe('acc-1')
    expect(payload.meta?.recordId).toBe('rec-1')
  })

  it('maps notification payload to SSE event, dropping accountId and keeping meta', () => {
    const event = mapNotificationNotifyToSSEEvent({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'canvas_completed',
      title: '画布项目已全部完成',
      meta: { projectId: 'proj-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    })

    expect(event).toEqual({
      id: 'n-1',
      type: 'canvas_completed',
      title: '画布项目已全部完成',
      meta: { projectId: 'proj-1', category: 'video' },
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    })
    // accountId 仅用于路由，不下发到前端
    expect('accountId' in event).toBe(false)
  })

  it('dispatches notification NOTIFY payloads through the provided transport', () => {
    const dispatched: Array<{ userId: string, event: string, data: unknown }> = []
    const handleNotification = createNotificationDispatcher({
      dispatchToUser: (userId, event, data) => dispatched.push({ userId, event, data }),
    })

    const result = handleNotification(JSON.stringify({
      id: 'n-1',
      accountId: 'acc-1',
      type: 'balance_warning',
      title: '余额不足',
      body: '请前往计费页充值',
      read: false,
      createdAt: '2026-06-14T00:00:00.000Z',
    }))

    expect(result?.payload.accountId).toBe('acc-1')
    expect(dispatched).toEqual([
      {
        userId: 'acc-1',
        event: SSE_NOTIFICATION_EVENT,
        data: {
          id: 'n-1',
          type: 'balance_warning',
          title: '余额不足',
          body: '请前往计费页充值',
          read: false,
          createdAt: '2026-06-14T00:00:00.000Z',
        },
      },
    ])
  })

  it('reports invalid notification payloads without dispatching', () => {
    const errors: Array<{ error: unknown, rawPayload: string }> = []
    const handleNotification = createNotificationDispatcher({
      dispatchToUser: () => {
        throw new Error('should not dispatch')
      },
      onError: (error, rawPayload) => errors.push({ error, rawPayload }),
    })

    expect(handleNotification('{bad json')).toBeNull()
    expect(errors).toHaveLength(1)
    expect(errors[0]!.rawPayload).toBe('{bad json')
  })
})
