import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  deleteRecord,
  fetchModels,
  generate,
  uploadFile,
} from '@/api/client'
import { useGenerationStore } from './generation'

/** 参数默认值：prompt 空字符串，数字 0，布尔 false，其余空字符串 */
export function getParamDefault(param: ModelParameter): unknown {
  if (param.name === 'prompt')
    return ''
  return param.defaultValue ?? (param.type === 'number' ? 0 : param.type === 'boolean' ? false : '')
}

/** 根据模型参数列表构建初始参数 */
export function buildInitialParameters(model: ModelConfig): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const p of model.parameters)
    defaults[p.name] = getParamDefault(p)
  return defaults
}

/** 检查必填参数是否都已填写 */
export function checkCanGenerate(model: ModelConfig, parameters: Record<string, unknown>): boolean {
  return model.parameters.filter(p => p.required && !parameters[p.name]).length === 0
}

export interface ReferenceFile {
  id: string
  url: string
  name: string
}

export interface MediaUploadEntry {
  uploading: boolean
  uploadedUrl?: string
  uploadedName?: string
}

export interface WorkspaceState {
  models: ModelConfig[]
  selectedCategory: Category
  selectedModelId: string
  parameters: Record<string, unknown>
  referenceFiles: ReferenceFile[]
  mediaUploadState: Record<string, MediaUploadEntry>
  loading: boolean
  uploadingRefs: boolean

  // Derived (computed on demand)
  categoryModels: () => ModelConfig[]
  selectedModel: () => ModelConfig | undefined
  canGenerate: () => boolean
  showReferenceUpload: () => boolean

  // Actions
  loadModels: () => Promise<void>
  setCategory: (category: Category) => void
  setModelId: (id: string) => void
  setParameter: (name: string, value: unknown) => void
  setParameters: (params: Record<string, unknown>) => void
  addReferenceFile: (file: ReferenceFile) => void
  removeReferenceFile: (id: string) => void
  setUploadingRefs: (v: boolean) => void
  setMediaUploadEntry: (paramName: string, entry: MediaUploadEntry) => void
  clearMediaUpload: (paramName: string) => void

  submit: () => Promise<void>
  regenerate: (record: GenerationRecord) => Promise<void>
  removeRecord: (id: string) => Promise<void>
  uploadReferenceFiles: (files: FileList) => Promise<void>
  uploadMediaParam: (paramName: string, accept: string) => Promise<void>
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  models: [],
  selectedCategory: 'image',
  selectedModelId: '',
  parameters: {},
  referenceFiles: [],
  mediaUploadState: {},
  loading: false,
  uploadingRefs: false,

  categoryModels: () => {
    const { models, selectedCategory } = get()
    return models.filter(m => m.category === selectedCategory)
  },

  selectedModel: () => {
    const { models, selectedModelId } = get()
    return models.find(m => m.id === selectedModelId)
  },

  canGenerate: () => {
    const model = get().selectedModel()
    if (!model)
      return false
    return checkCanGenerate(model, get().parameters)
  },

  showReferenceUpload: () => {
    return get().selectedModel()?.referenceMediaType != null
  },

  loadModels: async () => {
    const data = await fetchModels()
    set({ models: data.models })
  },

  setCategory: (category) => {
    set({ selectedCategory: category })
    const categoryModels = get().models.filter(m => m.category === category)
    if (categoryModels.length > 0) {
      const model = categoryModels[0]
      set({
        selectedModelId: model.id,
        parameters: buildInitialParameters(model),
        mediaUploadState: {},
      })
    }
  },

  setModelId: (id) => {
    const model = get().models.find(m => m.id === id)
    if (model) {
      set({
        selectedModelId: id,
        parameters: buildInitialParameters(model),
        mediaUploadState: {},
      })
    }
  },

  setParameter: (name, value) => {
    set(state => ({ parameters: { ...state.parameters, [name]: value } }))
  },

  setParameters: (params) => {
    set({ parameters: params })
  },

  addReferenceFile: (file) => {
    set(state => ({ referenceFiles: [...state.referenceFiles, file] }))
  },

  removeReferenceFile: (id) => {
    set(state => ({ referenceFiles: state.referenceFiles.filter(f => f.id !== id) }))
  },

  setUploadingRefs: (v) => {
    set({ uploadingRefs: v })
  },

  setMediaUploadEntry: (paramName, entry) => {
    set(state => ({ mediaUploadState: { ...state.mediaUploadState, [paramName]: entry } }))
  },

  clearMediaUpload: (paramName) => {
    set((state) => {
      const { [paramName]: _, ...rest } = state.mediaUploadState
      return {
        parameters: { ...state.parameters, [paramName]: '' },
        mediaUploadState: rest,
      }
    })
  },

  submit: async () => {
    const { selectedModel, parameters, referenceFiles } = get()
    const model = selectedModel()
    if (!model || !checkCanGenerate(model, parameters))
      return
    set({ loading: true })
    try {
      const referenceFileIds = referenceFiles.map(f => f.id)
      const result: GenerateResponse = await generate({
        model: model.id,
        parameters,
        referenceFileIds: referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success && result.record)
        useGenerationStore.getState().addRecord(result.record)
    }
    catch {
      toast.error('生成请求失败')
    }
    finally {
      set({ loading: false })
    }
  },

  regenerate: async (record) => {
    set({ loading: true })
    try {
      const result: GenerateResponse = await generate({
        model: record.model,
        parameters: record.inputParams,
      })
      if (result.success && result.record)
        useGenerationStore.getState().addRecord(result.record)
    }
    catch {
      toast.error('生成请求失败')
    }
    finally {
      set({ loading: false })
    }
  },

  removeRecord: async (id) => {
    try {
      await deleteRecord(id)
      useGenerationStore.getState().removeRecord(id)
    }
    catch {
      toast.error('删除记录失败')
    }
  },

  uploadReferenceFiles: async (files) => {
    set({ uploadingRefs: true })
    try {
      for (const file of Array.from(files)) {
        const result = await uploadFile(file)
        if (result.success)
          get().addReferenceFile({ id: result.file.id, url: result.file.publicUrl, name: result.file.fileName })
      }
    }
    finally {
      set({ uploadingRefs: false })
    }
  },

  uploadMediaParam: async (paramName, accept) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file)
        return
      get().setMediaUploadEntry(paramName, { uploading: true })
      try {
        const result = await uploadFile(file)
        if (result.success) {
          set(state => ({
            parameters: { ...state.parameters, [paramName]: result.file.publicUrl },
            mediaUploadState: {
              ...state.mediaUploadState,
              [paramName]: { uploading: false, uploadedUrl: result.file.publicUrl, uploadedName: result.file.fileName },
            },
          }))
        }
        else {
          get().setMediaUploadEntry(paramName, { uploading: false })
        }
      }
      catch {
        get().setMediaUploadEntry(paramName, { uploading: false })
      }
    }
    input.click()
  },
}))
