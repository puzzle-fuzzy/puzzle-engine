import type { SSEGenerationStatusEvent } from '@excuse/shared'
import type { GenerationRecord, ProjectDTO } from '@/api/client'
import { parseCostDetail, parseOutputResult } from '@excuse/shared'
import { create } from 'zustand'
import { fetchRecords, listCanvasProjects } from '@/api/client'
import { sseClient } from '@/api/sse'

interface GenerationState {
  records: GenerationRecord[]
  projectMap: Map<string, ProjectDTO>
  loadingRecords: boolean

  fetchRecords: () => Promise<void>
  fetchProjects: () => Promise<void>
  addRecord: (record: GenerationRecord) => void
  removeRecord: (id: string) => void
  updateRecordFromSSE: (event: SSEGenerationStatusEvent) => void
  subscribeSSE: () => () => void
}

export const useGenerationStore = create<GenerationState>((set, get) => ({
  records: [],
  projectMap: new Map(),
  loadingRecords: false,

  fetchRecords: async () => {
    set({ loadingRecords: true })
    try {
      const data = await fetchRecords({ limit: 100 })
      set({ records: data.records, loadingRecords: false })
    }
    catch {
      set({ loadingRecords: false })
    }
  },

  fetchProjects: async () => {
    try {
      const data = await listCanvasProjects()
      const map = new Map<string, ProjectDTO>()
      for (const p of data.data) {
        map.set(p.id, p)
      }
      set({ projectMap: map })
    }
    catch {}
  },

  addRecord: (record) => {
    set({ records: [record, ...get().records] })
  },

  removeRecord: (id) => {
    set({ records: get().records.filter(r => r.id !== id) })
  },

  updateRecordFromSSE: (event) => {
    const { records } = get()
    const existingIndex = records.findIndex(r => r.id === event.id)
    if (existingIndex >= 0) {
      const next = [...records]
      next[existingIndex] = {
        ...next[existingIndex],
        status: event.status,
        ...(event.outputResult && { outputResult: parseOutputResult(event.outputResult) }),
        ...(event.errorMessage && { errorMessage: event.errorMessage }),
        ...(event.cost && { cost: parseCostDetail(event.cost) }),
      }
      set({ records: next })
    }
    else {
      get().fetchRecords()
    }
  },

  subscribeSSE: () => {
    const unsubscribe = sseClient.on('generation_status', (event) => {
      get().updateRecordFromSSE(event)
    })
    return unsubscribe
  },
}))
