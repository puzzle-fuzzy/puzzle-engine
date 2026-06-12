import type { SubtitleProjectDTO, SubtitleSentence, SubtitleStyleConfig } from '@excuse/shared'
import { toast } from 'sonner'
import { create } from 'zustand'
import {
  createSubtitleProject,
  deleteSubtitleProject,
  exportSubtitleProject,
  getSubtitleProject,
  listSubtitleProjects,
  updateSubtitleSentences,
  updateSubtitleStyle,
} from '@/api/client'

export interface SubtitleState {
  projects: SubtitleProjectDTO[]
  currentProject: SubtitleProjectDTO | null
  loading: boolean
  exporting: boolean

  // Actions
  loadProjects: () => Promise<void>
  createProject: (videoFileId: string) => Promise<void>
  selectProject: (id: string) => Promise<void>
  updateSentences: (sentences: SubtitleSentence[]) => Promise<void>
  updateStyle: (styleConfig: SubtitleStyleConfig) => Promise<void>
  exportProject: () => Promise<void>
  deleteProject: (id: string) => Promise<void>
  updateProjectFromSSE: (partial: Partial<SubtitleProjectDTO>) => void
}

export const useSubtitleStore = create<SubtitleState>((set, get) => ({
  projects: [],
  currentProject: null,
  loading: false,
  exporting: false,

  loadProjects: async () => {
    try {
      const { items } = await listSubtitleProjects()
      set({ projects: items })
    }
    catch {
      toast.error('加载字幕项目失败')
    }
  },

  createProject: async (videoFileId: string) => {
    set({ loading: true })
    try {
      const { data } = await createSubtitleProject(videoFileId)
      set(state => ({ projects: [data, ...state.projects], currentProject: data, loading: false }))
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : '创建字幕项目失败')
      set({ loading: false })
    }
  },

  selectProject: async (id: string) => {
    try {
      const { data } = await getSubtitleProject(id)
      set({ currentProject: data })
    }
    catch {
      toast.error('加载项目详情失败')
    }
  },

  updateSentences: async (sentences: SubtitleSentence[]) => {
    const project = get().currentProject
    if (!project)
      return
    try {
      const { data } = await updateSubtitleSentences(project.id, sentences)
      set({ currentProject: data })
    }
    catch {
      toast.error('更新字幕失败')
    }
  },

  updateStyle: async (styleConfig: SubtitleStyleConfig) => {
    const project = get().currentProject
    if (!project)
      return
    try {
      const { data } = await updateSubtitleStyle(project.id, styleConfig)
      set({ currentProject: data })
    }
    catch {
      toast.error('更新样式失败')
    }
  },

  exportProject: async () => {
    const project = get().currentProject
    if (!project)
      return
    set({ exporting: true })
    try {
      await exportSubtitleProject(project.id)
      toast.success('导出任务已提交，完成后将自动通知')
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : '导出失败')
    }
    finally {
      set({ exporting: false })
    }
  },

  deleteProject: async (id: string) => {
    try {
      await deleteSubtitleProject(id)
      set(state => ({
        projects: state.projects.filter(p => p.id !== id),
        currentProject: state.currentProject?.id === id ? null : state.currentProject,
      }))
    }
    catch {
      toast.error('删除项目失败')
    }
  },

  updateProjectFromSSE: (partial: Partial<SubtitleProjectDTO>) => {
    const currentProject = get().currentProject
    if (!currentProject)
      return
    set({
      currentProject: { ...currentProject, ...partial },
      projects: get().projects.map(p => p.id === currentProject.id ? { ...p, ...partial } : p),
    })
  },
}))
