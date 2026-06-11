import type { AuthResponse, BillingStatistics, GenerateResponse, GenerationRecord, ModelConfig, ProjectDTO } from '@excuse/shared'
import type { App } from '../../../server/src/index'
import { treaty } from '@elysia/eden'
import { sseClient } from './sse'

/**
 * Eden Treaty 客户端 — 端到端类型安全
 *
 * 通过 Vite 代理 (/api → localhost:5007) 与后端通信
 * 类型从 Drizzle schema → @excuse/db → @excuse/shared 单向推导
 *
 * 注意：Eden 从 Elysia 路由推导的类型与 @excuse/shared 的手动定义
 * 存在微妙差异（联合类型结构、字段可选性等），不能直接赋值。
 * unwrapEden 封装了必要的类型转换，保留 Eden 的运行时错误处理。
 */

// ===== Token 管理 =====

const AUTH_TOKEN_KEY = 'auth_token'

let authToken: string | null = localStorage.getItem(AUTH_TOKEN_KEY)

/** 设置认证 token（同步到 localStorage，联动 SSE 连接） */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token)
    sseClient.connect()
  }
  else {
    localStorage.removeItem(AUTH_TOKEN_KEY)
    sseClient.disconnect()
  }
}

/** 获取当前 token */
export function getAuthToken() {
  return authToken
}

// ===== Eden Treaty 客户端 =====

export const api = treaty<App>(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:5007', {
  headers: () => ({
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
  }),
})

// ===== 导出共享类型 =====

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'
export type CostDetail = GenerationRecord['cost']

// ===== Eden 响应解包工具 =====

/**
 * 解包 Eden Treaty 响应：提取 data 或抛出 error
 *
 * Eden 返回 { data, error }，data 类型是 Eden 从 Elysia 推导的，
 * 与 @excuse/shared 的类型有细微结构差异无法直接赋值。
 * 此函数将 data 转为 shared 包定义的类型 T，封装必要的转换。
 */
function unwrapEden<T>(response: { data: unknown, error: unknown }): T {
  if (response.error)
    throw response.error
  return response.data as T
}

// ===== 认证 API =====

export async function registerRequest(username: string, email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.register.post({ username, email, password }),
  )
}

export async function loginRequest(email: string, password: string): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.login.post({ email, password }),
  )
}

export async function fetchCurrentUser(): Promise<AuthResponse> {
  return unwrapEden<AuthResponse>(
    await api.api.auth.me.get(),
  )
}

// ===== 业务 API =====

export async function fetchModels(): Promise<{ models: ModelConfig[] }> {
  return unwrapEden<{ models: ModelConfig[] }>(
    await api.api.models.get(),
  )
}

/** 发起生成 — 返回完整 GenerationRecord */
export async function generate(params: {
  model: string
  parameters: Record<string, unknown>
  referenceFileIds?: string[]
}): Promise<GenerateResponse> {
  return unwrapEden<GenerateResponse>(
    await api.api.generate.post(params),
  )
}

export async function fetchRecords(params?: {
  category?: string
  status?: string
  limit?: number
  offset?: number
}): Promise<{ records: GenerationRecord[], total: number }> {
  return unwrapEden<{ records: GenerationRecord[], total: number }>(
    await api.api.records.get({
      query: {
        category: params?.category ?? '',
        status: params?.status ?? '',
        limit: params?.limit ?? 50,
        offset: params?.offset ?? 0,
      },
    }),
  )
}

export async function fetchRecord(id: string): Promise<{ success: boolean, record: GenerationRecord }> {
  return unwrapEden<{ success: boolean, record: GenerationRecord }>(
    await api.api.records({ id }).get(),
  )
}

export async function deleteRecord(id: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.records({ id }).delete(),
  )
}

export async function retryRecord(id: string): Promise<GenerateResponse> {
  return unwrapEden<GenerateResponse>(
    await api.api.records({ id }).retry.post(),
  )
}

export async function cancelRecord(id: string): Promise<{ success: boolean, record: GenerationRecord }> {
  return unwrapEden<{ success: boolean, record: GenerationRecord }>(
    await api.api.records({ id }).cancel.post(),
  )
}

export async function uploadFile(file: File): Promise<{
  success: boolean
  file: { id: string, fileName: string, publicUrl: string, mimeType: string }
}> {
  return unwrapEden<{
    success: boolean
    file: { id: string, fileName: string, publicUrl: string, mimeType: string }
  }>(
    await api.api.upload.post({ file }),
  )
}

export async function deleteUploadedFile(id: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.upload({ id }).delete(),
  )
}

export async function fetchBillingStatistics(): Promise<{
  success: boolean
  statistics: BillingStatistics
}> {
  return unwrapEden<{ success: boolean, statistics: BillingStatistics }>(
    await api.api.billing.statistics.get(),
  )
}

// ===== Canvas 流水线 API =====

export async function createCanvasProject(params: {
  title?: string
  storyText: string
}): Promise<{ success: boolean, data: ProjectDTO }> {
  return unwrapEden<{ success: boolean, data: ProjectDTO }>(
    await api.api.canvas.projects.post(params),
  )
}

export async function listCanvasProjects(): Promise<{ success: boolean, data: ProjectDTO[] }> {
  return unwrapEden<{ success: boolean, data: ProjectDTO[] }>(
    await api.api.canvas.projects.get(),
  )
}

export async function getCanvasProject(projectId: string): Promise<{ success: boolean, data: ProjectDTO }> {
  return unwrapEden<{ success: boolean, data: ProjectDTO }>(
    await api.api.canvas.projects({ projectId }).get(),
  )
}

export async function deleteCanvasProject(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).delete(),
  )
}

/** 更新项目标题/故事文本 */
export async function updateCanvasProject(projectId: string, patch: { title?: string, storyText?: string }): Promise<{ success: boolean, data: ProjectDTO }> {
  return unwrapEden<{ success: boolean, data: ProjectDTO }>(
    await api.api.canvas.projects({ projectId }).patch(patch),
  )
}

export async function analyzeCanvasProject(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).analyze.post(),
  )
}

export async function generateCanvasCharacters(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).characters.post(),
  )
}

export async function generateCanvasLocations(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).locations.post(),
  )
}

export async function generateCanvasCharacterRefs(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId })['character-refs'].post(),
  )
}

export async function generateCanvasLocationRefs(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId })['location-refs'].post(),
  )
}

export async function generateCanvasStoryboard(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).storyboard.post(),
  )
}

export async function checkCanvasContinuity(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).continuity.post(),
  )
}

export async function rebuildCanvasPrompts(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId })['rebuild-prompts'].post(),
  )
}

export async function generateCanvasVideos(projectId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId })['generate-videos'].post(),
  )
}

export async function saveCanvasLayout(projectId: string, layout: Record<string, unknown>): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.projects({ projectId }).layout.post(layout),
  )
}

export async function updateCanvasModelPreferences(
  projectId: string,
  prefs: { textModel?: string, imageModel?: string, videoModel?: string },
): Promise<{ success: boolean, data: ProjectDTO }> {
  return unwrapEden<{ success: boolean, data: ProjectDTO }>(
    await api.api.canvas.projects({ projectId })['model-preferences'].patch(prefs),
  )
}

export async function updateCanvasCharacter(characterId: string, patch: {
  name?: string
  role?: string
  description?: string
  identityPrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}): Promise<{ success: boolean, data: unknown }> {
  return unwrapEden<{ success: boolean, data: unknown }>(
    await api.api.canvas.characters({ characterId }).patch(patch),
  )
}

export async function updateCanvasLocation(locationId: string, patch: {
  name?: string
  type?: string
  scenePrompt?: string
  negativePrompt?: string
  referenceImageUrl?: string
  locked?: boolean
}): Promise<{ success: boolean, data: unknown }> {
  return unwrapEden<{ success: boolean, data: unknown }>(
    await api.api.canvas.locations({ locationId }).patch(patch),
  )
}

export async function updateCanvasShot(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: Record<string, unknown>
  environmentJson?: Record<string, unknown>
  videoPrompt?: string
}): Promise<{ success: boolean, data: unknown }> {
  return unwrapEden<{ success: boolean, data: unknown }>(
    await api.api.canvas.shots({ shotId }).patch(patch),
  )
}

export async function deleteCanvasCharacter(characterId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.characters({ characterId }).delete(),
  )
}

export async function deleteCanvasLocation(locationId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.locations({ locationId }).delete(),
  )
}

export async function deleteCanvasShot(shotId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.shots({ shotId }).delete(),
  )
}

export async function retryCanvasShot(shotId: string): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.canvas.shots({ shotId }).retry.post(),
  )
}
