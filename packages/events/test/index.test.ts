import { describe, expect, it } from 'bun:test'
import {
  createGenerationNotifyDispatcher,
  GENERATION_STATUS_CHANNEL,
  mapGenerationNotifyToSSEEvents,
  parseGenerationNotifyPayload,
  SSE_GENERATION_STATUS_EVENT,
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
})
