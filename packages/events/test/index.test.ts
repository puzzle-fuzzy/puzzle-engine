import { describe, expect, it } from 'bun:test'
import {
  GENERATION_STATUS_CHANNEL,
  mapGenerationNotifyToSSEEvents,
  parseGenerationNotifyPayload,
  SSE_GENERATION_STATUS_EVENT,
  SSE_PIPELINE_NODE_EVENT,
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
})
