import type { SSEGenerationStatusEvent, SSEPipelineNodeEvent } from '@excuse/shared'
import { create } from 'zustand'
import { sseClient } from '@/api/sse'
import { useGenerationStore } from './generation'
import { useSubtitleStore } from './subtitle'

interface PhaseDoneEvent {
  key: string
  status: 'completed' | 'failed'
  error?: string
}

interface RealtimeSyncState {
  /** Pipeline 阶段完成信号 — 由 PipelineController 消费 */
  phaseDone: PhaseDoneEvent | null
  consumePhaseDone: () => void

  /**
   * 项目版本计数器 — CanvasEditor watch projectVersions[projectId]
   * 每次 pipeline_node_update 到达时递增，触发 CanvasEditor 重新加载项目
   */
  projectVersions: Record<string, number>

  /**
   * 注册 SSE 事件订阅 — 在 App.tsx 中调用一次
   * @returns 取消订阅函数
   */
  initialize: () => () => void
}

export const useRealtimeSync = create<RealtimeSyncState>((set, get) => ({
  phaseDone: null,
  projectVersions: {},

  consumePhaseDone: () => {
    set({ phaseDone: null })
  },

  initialize: () => {
    const unsubPipeline = sseClient.on('pipeline_node_update', (event: SSEPipelineNodeEvent) => {
      handlePipelineNodeUpdate(event, set, get)
    })

    const unsubGeneration = sseClient.on('generation_status', (event: SSEGenerationStatusEvent) => {
      if (event.category === 'subtitle') {
        // 字幕任务的状态变更 — 刷新当前项目详情
        const currentProject = useSubtitleStore.getState().currentProject
        if (currentProject) {
          useSubtitleStore.getState().selectProject(currentProject.id)
        }
        // 同时更新项目列表
        useSubtitleStore.getState().loadProjects()
      }
      else {
        useGenerationStore.getState().updateRecordFromSSE(event)
      }
    })

    const unsubOpen = sseClient.onOpen(() => {
      // 重连后刷新数据，补偿断连期间丢失的事件
      useGenerationStore.getState().fetchRecords()
    })

    return () => {
      unsubPipeline()
      unsubGeneration()
      unsubOpen()
    }
  },
}))

function handlePipelineNodeUpdate(
  event: SSEPipelineNodeEvent,
  set: (partial: Partial<RealtimeSyncState>) => void,
  get: () => RealtimeSyncState,
) {
  const { projectVersions } = get()

  // 递增项目版本，触发 CanvasEditor 重新加载
  set({
    projectVersions: {
      ...projectVersions,
      [event.projectId]: (projectVersions[event.projectId] || 0) + 1,
    },
  })

  // Pipeline 阶段完成信号 — 传递给 PipelineController
  if (event.nodeType === 'phase') {
    set({
      phaseDone: {
        key: event.nodeId,
        status: event.status === 'completed' ? 'completed' : 'failed',
        error: event.error,
      },
    })
  }
}
