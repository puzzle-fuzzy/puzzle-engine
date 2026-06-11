import type { AuthResponse, BillingStatistics, GenerateResponse, GenerationRecord, ModelConfig, ProjectDTO } from '@excuse/shared'
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'
import { sseClient } from './sse'

/**
 * Eden Treaty 客户端 — 端到端类型安全
 *
 * 通过 Vite 代理 (/api → localhost:5007) 与后端通信
 * 类型从 Drizzle schema → @excuse/db → @excuse/shared 单向推导
 */

// ===== Token 管理 =====

const AUTH_TOKEN_KEY = 'auth_token'

let authToken: string | null = localStorage.getItem(AUTH_TOKEN_KEY)

/** 设置认证 token（同步到 localStorage，联动 SSE 连接） */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    sseClient.connect() // 登录 → 建立 SSE 连接
  }
  else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    sseClient.disconnect() // 登出 → 断开 SSE 连接
  }
}

/** 获取当前 token */
export function getAuthToken() {
  return authToken
}

// ===== Eden Treaty 客户端 =====

export const api = treaty<App>('http://localhost:5007', {
  headers: () => ({
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }),
})

// ===== 导出共享类型（页面直接使用） =====

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'

/**
 * 费用信息类型（API 返回的 jsonb cost 字段）
 * 序列化后与 CostDetail 结构一致
 */
export type CostDetail = GenerationRecord['cost']

// ===== 认证 API =====

/** 注册 */
export async function registerRequest(username: string, email: string, password: string): Promise<AuthResponse> {
  const { data, error } = await api.api.auth.register.post({ username, email, password })
  if (error)
    throw error
  return data as unknown as AuthResponse
}

/** 登录 */
export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  const { data, error } = await api.api.auth.login.post({ email, password })
  if (error)
    throw error
  return data as unknown as AuthResponse
}

/** 获取当前用户 */
export async function fetchCurrentUser(): Promise<AuthResponse> {
  const { data, error } = await api.api.auth.me.get()
  if (error)
    throw error
  return data as unknown as AuthResponse
}

// ===== 业务 API =====

/** 获取支持的模型列表 */
export async function fetchModels(): Promise<{ models: ModelConfig[] }> {
  const { data, error } = await api.api.models.get()
  if (error)
    throw error
  return data as unknown as { models: ModelConfig[] }
}

/** 发起生成 — 返回完整 GenerationRecord */
export async function generate(params: {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}): Promise<GenerateResponse> {
  const { data, error } = await api.api.generate.post(params)
  if (error)
    throw error
  return data as unknown as GenerateResponse
}

/** 获取生成记录列表 */
export async function fetchRecords(params?: {
  category?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<{ records: GenerationRecord[], total: number }> {
  const { data, error } = await api.api.records.get({
    query: {
      category: params?.category ?? '',
      status: params?.status ?? '',
      limit: params?.limit ?? 50,
      offset: params?.offset ?? 0,
    },
  })
  if (error)
    throw error
  return data as unknown as { records: GenerationRecord[], total: number }
}

/** 获取单条记录 */
export async function fetchRecord(id: string): Promise<{ success: boolean, record: GenerationRecord }> {
  const { data, error } = await api.api.records({ id }).get()
  if (error)
    throw error
  return data as unknown as { success: boolean, record: GenerationRecord }
}

/** 删除单条记录 */
export async function deleteRecord(id: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.records({ id }).delete()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 上传文件 */
export async function uploadFile(file: File): Promise<{
  success: boolean
  file: { id: string, fileName: string, publicUrl: string, mimeType: string }
}> {
  const { data, error } = await api.api.upload.post({ file })
  if (error)
    throw error
  return data as unknown as {
    success: boolean
    file: { id: string, fileName: string, publicUrl: string, mimeType: string }
  }
}

/** 获取计费统计 */
export async function fetchBillingStatistics(): Promise<{
  success: boolean
  statistics: BillingStatistics
}> {
  const { data, error } = await api.api.billing.statistics.get()
  if (error)
    throw error
  return data as unknown as { success: boolean, statistics: BillingStatistics }
}

// ===== Canvas 流水线 API =====

/** 创建 Canvas 项目 */
export async function createCanvasProject(params: {
  title?: string
  storyText: string
}): Promise<{ success: boolean, data: ProjectDTO }> {
  const { data, error } = await api.api.canvas.projects.post(params)
  if (error)
    throw error
  return data as unknown as { success: boolean, data: ProjectDTO }
}

/** 获取项目列表 */
export async function listCanvasProjects(): Promise<{ success: boolean, data: ProjectDTO[] }> {
  const { data, error } = await api.api.canvas.projects.get()
  if (error)
    throw error
  return data as unknown as { success: boolean, data: ProjectDTO[] }
}

/** 获取项目详情（含关联数据） */
export async function getCanvasProject(projectId: string): Promise<{ success: boolean, data: ProjectDTO }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).get()
  if (error)
    throw error
  return data as unknown as { success: boolean, data: ProjectDTO }
}

/** 删除项目 */
export async function deleteCanvasProject(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).delete()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 分析故事 (fire-and-forget: 立即返回，SSE 推送进度) */
export async function analyzeCanvasProject(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).analyze.post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 生成角色 */
export async function generateCanvasCharacters(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).characters.post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 生成场景 */
export async function generateCanvasLocations(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).locations.post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 生成角色参考图 */
export async function generateCanvasCharacterRefs(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId })['character-refs'].post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 生成场景参考图 */
export async function generateCanvasLocationRefs(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId })['location-refs'].post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 生成分镜 */
export async function generateCanvasStoryboard(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).storyboard.post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 连续性检查 */
export async function checkCanvasContinuity(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).continuity.post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 重建 Prompt */
export async function rebuildCanvasPrompts(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId })['rebuild-prompts'].post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 批量生成视频 */
export async function generateCanvasVideos(projectId: string): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId })['generate-videos'].post()
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 保存画布布局 */
export async function saveCanvasLayout(projectId: string, layout: Record<string, unknown>): Promise<{ success: boolean }> {
  const { data, error } = await api.api.canvas.projects({ projectId }).layout.post(layout)
  if (error)
    throw error
  return data as unknown as { success: boolean }
}

/** 更新模型偏好 */
export async function updateCanvasModelPreferences(
  projectId: string,
  prefs: { textModel?: string, imageModel?: string, videoModel?: string },
): Promise<{ success: boolean, data: ProjectDTO }> {
  const { data, error } = await api.api.canvas.projects({ projectId })['model-preferences'].patch(prefs)
  if (error)
    throw error
  return data as unknown as { success: boolean, data: ProjectDTO }
}

/** 更新角色 */
export async function updateCanvasCharacter(characterId: string, patch: {
  identityPrompt?: string
  negativePrompt?: string
  locked?: boolean
}): Promise<{ success: boolean, data: unknown }> {
  const { data, error } = await api.api.canvas.characters({ characterId }).patch(patch)
  if (error)
    throw error
  return data as unknown as { success: boolean, data: unknown }
}

/** 更新场景 */
export async function updateCanvasLocation(locationId: string, patch: {
  scenePrompt?: string
  negativePrompt?: string
  locked?: boolean
}): Promise<{ success: boolean, data: unknown }> {
  const { data, error } = await api.api.canvas.locations({ locationId }).patch(patch)
  if (error)
    throw error
  return data as unknown as { success: boolean, data: unknown }
}

/** 更新镜头 */
export async function updateCanvasShot(shotId: string, patch: {
  narrative?: string
  videoPrompt?: string
}): Promise<{ success: boolean, data: unknown }> {
  const { data, error } = await api.api.canvas.shots({ shotId }).patch(patch)
  if (error)
    throw error
  return data as unknown as { success: boolean, data: unknown }
}
