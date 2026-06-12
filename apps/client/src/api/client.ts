import type { AcceptedResponse, AuthResponse, BillingStatistics, CharacterDTO, GenerateResponse, GenerationRecord, LocationDTO, ModelConfig, MutationOkResponse, ProjectDTO, ShotDTO, UploadResponse } from '@excuse/shared'
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

/**
 * 认证 token — 仅存内存，用于 SSE Authorization header
 * 浏览器 API 请求通过 httpOnly cookie 自动认证（无需手动设置 header）
 */
let authToken: string | null = null

/** 设置认证 token（内存 + 联动 SSE 连接） */
export function setAuthToken(token: string | null) {
  authToken = token
  if (token) {
    sseClient.connect()
  }
  else {
    sseClient.disconnect()
  }
}

/** 获取当前 token（SSE 使用） */
export function getAuthToken() {
  return authToken
}

// ===== Eden Treaty 客户端 =====

function normalizeApiBaseUrl(baseUrl: string | undefined): string {
  if (!baseUrl)
    return ''
  return baseUrl.replace(/\/api\/?$/, '')
}

export function resolveApiBaseUrl() {
  const normalized = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE_URL)
  if (normalized)
    return normalized
  if (typeof window !== 'undefined' && window.location?.origin)
    return window.location.origin
  return 'http://localhost:5007'
}

export const api = treaty<App>(resolveApiBaseUrl())

// ===== 导出共享类型 =====

export type { ModelConfig, ModelParameter } from '@excuse/shared'
export type { AcceptedResponse, GenerateResponse, GenerationRecord } from '@excuse/shared'
export type { BillingStatistics } from '@excuse/shared'
export type CostDetail = GenerationRecord['cost']

/**
 * Eden 响应中的错误结构
 * Eden 将非 2xx 响应包装为 { status, statusText, headers, ... } 等
 */
interface EdenError {
  status?: number
  statusText?: string
  message?: string
  value?: unknown
}

interface ApiErrorValue {
  error: string
}

function isApiErrorValue(value: unknown): value is ApiErrorValue {
  return typeof value === 'object'
    && value !== null
    && 'error' in value
    && typeof value.error === 'string'
}

/**
 * 解包 Eden Treaty 响应：提取 data 或抛出结构化错误
 *
 * Eden 返回 { data, error }，data 类型是 Eden 从 Elysia 推导的，
 * 与 @excuse/shared 的类型有细微结构差异无法直接赋值。
 * 此函数将 data 转为 shared 包定义的类型 T，封装必要的转换。
 *
 * 错误处理策略：
 *   - 401/403: 认证问题，触发登录态清理
 *   - 422: 参数校验失败，展示具体字段错误
 *   - 其他: 展示通用错误消息
 */
function unwrapEden<T>(response: { data: unknown, error: unknown }): T {
  if (response.error) {
    const edenErr = response.error as EdenError
    const message = isApiErrorValue(edenErr.value)
      ? edenErr.value.error || edenErr.statusText || '请求失败'
      : edenErr.message || edenErr.statusText || '请求失败'
    const error = new Error(message) as Error & { status?: number }
    error.status = edenErr.status
    throw error
  }
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

export async function logoutRequest(): Promise<{ success: boolean }> {
  return unwrapEden<{ success: boolean }>(
    await api.api.auth.logout.post(),
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
        category: params?.category || undefined,
        status: params?.status || undefined,
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

export async function uploadFile(file: File): Promise<UploadResponse> {
  return unwrapEden<UploadResponse>(
    await api.api.upload.post({ file }),
  )
}

export async function deleteUploadedFile(id: string): Promise<MutationOkResponse> {
  return unwrapEden<MutationOkResponse>(
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

export async function analyzeCanvasProject(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).analyze.post(),
  )
}

export async function generateCanvasCharacters(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).characters.post(),
  )
}

export async function generateCanvasLocations(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).locations.post(),
  )
}

export async function generateCanvasCharacterRefs(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['character-refs'].post(),
  )
}

export async function generateCanvasLocationRefs(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['location-refs'].post(),
  )
}

export async function generateCanvasStoryboard(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).storyboard.post(),
  )
}

export async function checkCanvasContinuity(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId }).continuity.post(),
  )
}

export async function rebuildCanvasPrompts(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['rebuild-prompts'].post(),
  )
}

export async function generateCanvasVideos(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['generate-videos'].post(),
  )
}

export async function saveCanvasLayout(projectId: string, layout: import('@excuse/shared').CanvasLayoutDto): Promise<{ success: boolean }> {
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
}): Promise<{ success: boolean, data: CharacterDTO }> {
  return unwrapEden<{ success: boolean, data: CharacterDTO }>(
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
}): Promise<{ success: boolean, data: LocationDTO }> {
  return unwrapEden<{ success: boolean, data: LocationDTO }>(
    await api.api.canvas.locations({ locationId }).patch(patch),
  )
}

export async function updateCanvasShot(shotId: string, patch: {
  duration?: number
  locationId?: string
  characterIdsJson?: string[]
  narrative?: string
  cameraJson?: { shotSize: string, angle: string, movement: string, lens: string }
  environmentJson?: { backgroundMotion?: string, lighting?: string, mood?: string, style?: string }
  videoPrompt?: string
}): Promise<{ success: boolean, data: ShotDTO }> {
  return unwrapEden<{ success: boolean, data: ShotDTO }>(
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

export async function retryCanvasShot(shotId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.shots({ shotId }).retry.post(),
  )
}

export async function retryFailedCanvasShots(projectId: string): Promise<AcceptedResponse> {
  return unwrapEden<AcceptedResponse>(
    await api.api.canvas.projects({ projectId })['retry-failed-shots'].post(),
  )
}
