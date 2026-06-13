import type { GenerationNotifyPayload, SSEGenerationStatusEvent, SSEPipelineNodeEvent } from '@excuse/shared'

export const GENERATION_STATUS_CHANNEL = 'generation_status'
export const SSE_GENERATION_STATUS_EVENT = 'generation_status'
export const SSE_PIPELINE_NODE_EVENT = 'pipeline_node_update'

export interface UserSSEEvent {
  userId: string
  event: typeof SSE_GENERATION_STATUS_EVENT | typeof SSE_PIPELINE_NODE_EVENT
  data: SSEGenerationStatusEvent | SSEPipelineNodeEvent
}

export type EventSender = (event: string, data: unknown) => void
export type EventDispatchErrorHandler = (error: unknown, send: EventSender) => void

export interface GenerationNotifyDispatchResult {
  payload: GenerationNotifyPayload
  events: UserSSEEvent[]
}

export interface GenerationNotifyDispatcherOptions {
  dispatchToUser: (userId: string, event: string, data: unknown) => void
  onError?: (error: unknown, rawPayload: string) => void
}

export class UserEventHub {
  private readonly connections = new Map<string, Set<EventSender>>()

  addConnection(userId: string, send: EventSender): number {
    if (!this.connections.has(userId))
      this.connections.set(userId, new Set())

    const userConnections = this.connections.get(userId)!
    userConnections.add(send)
    return userConnections.size
  }

  removeConnection(userId: string, send: EventSender): number {
    const userConnections = this.connections.get(userId)
    if (!userConnections)
      return 0

    userConnections.delete(send)
    const remaining = userConnections.size
    if (remaining === 0)
      this.connections.delete(userId)

    return remaining
  }

  dispatchToUser(userId: string, event: string, data: unknown, onError?: EventDispatchErrorHandler): number {
    const userConnections = this.connections.get(userId)
    if (!userConnections || userConnections.size === 0)
      return 0

    let dispatched = 0
    for (const send of userConnections) {
      try {
        send(event, data)
        dispatched += 1
      }
      catch (error) {
        onError?.(error, send)
      }
    }
    return dispatched
  }

  getOnlineUserCount(): number {
    return this.connections.size
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0
  }
}

export function parseGenerationNotifyPayload(rawPayload: string): GenerationNotifyPayload {
  return JSON.parse(rawPayload) as GenerationNotifyPayload
}

export function mapGenerationNotifyToSSEEvents(payload: GenerationNotifyPayload): UserSSEEvent[] {
  const events: UserSSEEvent[] = [
    {
      userId: payload.accountId,
      event: SSE_GENERATION_STATUS_EVENT,
      data: {
        id: payload.recordId,
        taskId: payload.taskId,
        traceId: payload.traceId,
        status: payload.status,
        category: payload.category,
        model: payload.model,
        ...(payload.outputResult && { outputResult: payload.outputResult }),
        ...(payload.errorMessage && { errorMessage: payload.errorMessage }),
        ...(payload.cost && { cost: payload.cost }),
      },
    },
  ]

  if (payload.canvasMeta) {
    events.push({
      userId: payload.accountId,
      event: SSE_PIPELINE_NODE_EVENT,
      data: {
        projectId: payload.canvasMeta.projectId,
        nodeType: 'shot',
        nodeId: payload.canvasMeta.shotId,
        status: payload.status === 'succeeded' ? 'completed' : payload.status === 'failed' ? 'failed' : 'running',
      },
    })

    if (payload.canvasMeta.projectStatus) {
      events.push({
        userId: payload.accountId,
        event: SSE_PIPELINE_NODE_EVENT,
        data: {
          projectId: payload.canvasMeta.projectId,
          nodeType: 'phase',
          nodeId: 'videos',
          status: payload.canvasMeta.projectStatus === 'completed' ? 'completed' : 'failed',
          data: { projectStatus: payload.canvasMeta.projectStatus },
        },
      })
    }
  }

  return events
}

export function createGenerationNotifyDispatcher(options: GenerationNotifyDispatcherOptions) {
  return (rawPayload: string): GenerationNotifyDispatchResult | null => {
    try {
      const payload = parseGenerationNotifyPayload(rawPayload)
      const events = mapGenerationNotifyToSSEEvents(payload)
      for (const event of events) {
        options.dispatchToUser(event.userId, event.event, event.data)
      }
      return { payload, events }
    }
    catch (error) {
      options.onError?.(error, rawPayload)
      return null
    }
  }
}
