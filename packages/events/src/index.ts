import type { GenerationNotifyPayload, SSEGenerationStatusEvent, SSEPipelineNodeEvent } from '@excuse/shared'

export const GENERATION_STATUS_CHANNEL = 'generation_status'
export const SSE_GENERATION_STATUS_EVENT = 'generation_status'
export const SSE_PIPELINE_NODE_EVENT = 'pipeline_node_update'

export interface UserSSEEvent {
  userId: string
  event: typeof SSE_GENERATION_STATUS_EVENT | typeof SSE_PIPELINE_NODE_EVENT
  data: SSEGenerationStatusEvent | SSEPipelineNodeEvent
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
