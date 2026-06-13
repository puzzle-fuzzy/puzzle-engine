/**
 * Canvas pipeline phase handlers — Worker 端执行
 *
 * 通过 Bun runtime 动态加载 server 端 canvas service 函数。
 * TypeScript 无法检查跨 app import，所以用类型声明 + 运行时加载。
 *
 * Service 函数内部 `notifyNode` → `dispatchToUser`
 * 在 Worker 进程中无 SSE 连接，静默丢弃。
 * Worker handler 入口和出口通过 PostgreSQL NOTIFY 发通知。
 */

import type { TaskRow } from '@excuse/db'
import type { WorkerConfig } from './config'
import {
  getCanvasProjectById,
  markPipelineRunFailed,
  markPipelineRunRunning,
  markPipelineRunSucceeded,
  pgClient,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { executeCanvasContinuity } from './canvas-continuity'
import { executeCanvasRebuild } from './canvas-rebuild'

const logger = createLogger('canvas-handler')

// ── Provider config 构建 ──────────────────────────────────

function providerConfig(workerConfig: WorkerConfig) {
  return {
    dashscopeApiKey: workerConfig.dashscopeApiKey,
    dashscopeBaseUrl: workerConfig.dashscopeBaseUrl,
  }
}

function storageConfig(workerConfig: WorkerConfig) {
  return {
    dashscopeApiKey: workerConfig.dashscopeApiKey,
    dashscopeBaseUrl: workerConfig.dashscopeBaseUrl,
    storageRoot: workerConfig.storageRoot,
    oss: workerConfig.oss,
  }
}

// ── Server canvas service function types ────────────────────
// Types match actual server function signatures for safe dynamic loading.

interface CanvasServiceModule {
  analyzeProject: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) => Promise<void>
  generateCharacters: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) => Promise<void>
  generateLocations: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) => Promise<void>
  generateCharacterRefs: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss: any }, runId?: string) => Promise<void>
  generateLocationRefs: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string, storageRoot: string, oss: any }, runId?: string) => Promise<void>
  generateStoryboard: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) => Promise<void>
  generateVideos: (projectId: string, config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }, runId?: string) => Promise<void>
}

/**
 * 加载 server 端 canvas service 函数
 *
 * Bun runtime 支持跨 monorepo app 的相对路径 import。
 * 使用 require() + 统一类型接口避免 TypeScript rootDir 检查失败。
 */
function loadCanvasServices(): CanvasServiceModule {
  // Bun runtime resolves cross-app relative paths correctly at runtime.
  // TypeScript cannot check these imports — we use a typed interface instead.
  // eslint-disable-next-line ts/no-require-imports
  const serviceMod: CanvasServiceModule = require('../../server/src/modules/canvas/service.ts') as CanvasServiceModule
  return serviceMod
}

// ── PostgreSQL NOTIFY helper ──────────────────────────────

async function notifyNodeViaPgNotify(
  accountId: string,
  projectId: string,
  nodeType: string,
  nodeId: string,
  status: string,
  data?: Record<string, unknown>,
  error?: string,
  runId?: string,
) {
  await pgClient.notify('canvas_node_update', JSON.stringify({
    accountId,
    projectId,
    nodeType,
    nodeId,
    status,
    data,
    error,
    runId,
  }))
}

// ── Pipeline run 状态管理 ──────────────────────────────────

async function markRunRunningAndNotify(task: TaskRow): Promise<string | null> {
  const runId = task.targetId ?? null
  if (!runId)
    return null

  await markPipelineRunRunning(runId)

  const project = await getCanvasProjectById(task.projectId!)
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'running', undefined, undefined, runId)
  }
  return runId
}

async function markRunSucceededAndNotify(task: TaskRow, outputSummary?: Record<string, unknown>): Promise<void> {
  const runId = task.targetId ?? null
  if (runId) {
    await markPipelineRunSucceeded(runId, outputSummary)
  }

  const project = await getCanvasProjectById(task.projectId!)
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'completed', outputSummary, undefined, runId ?? undefined)
  }
}

/** Mark pipeline run as failed + notify frontend — called by handleTaskError */
export async function markRunFailedAndNotify(task: TaskRow, errorMessage: string): Promise<void> {
  const runId = task.targetId ?? null
  if (runId) {
    await markPipelineRunFailed(runId, errorMessage)
  }

  const project = await getCanvasProjectById(task.projectId!)
  if (project) {
    const phaseKey = task.type.replace('canvas.', '')
    await notifyNodeViaPgNotify(project.accountId, task.projectId!, 'phase', phaseKey, 'failed', undefined, errorMessage, runId ?? undefined)
  }
}

// ── Canvas phase handlers ──────────────────────────────────
// Lazy-load service module on first canvas handler call

let svc: CanvasServiceModule | null = null

function getService(): CanvasServiceModule {
  if (!svc) {
    svc = loadCanvasServices()
    logger.info('Canvas service module loaded from server')
  }
  return svc
}

export async function handleCanvasAnalyze(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().analyzeProject(projectId, providerConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'analyze', projectId }
}

export async function handleCanvasCharacters(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateCharacters(projectId, providerConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'characters', projectId }
}

export async function handleCanvasLocations(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateLocations(projectId, providerConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'locations', projectId }
}

export async function handleCanvasCharacterRefs(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateCharacterRefs(projectId, storageConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'characterRefs', projectId }
}

export async function handleCanvasLocationRefs(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateLocationRefs(projectId, storageConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'locationRefs', projectId }
}

export async function handleCanvasStoryboard(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateStoryboard(projectId, providerConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'storyboard', projectId }
}

export async function handleCanvasContinuity(task: TaskRow, _workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasContinuity(projectId, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasRebuild(task: TaskRow, _workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  const result = await executeCanvasRebuild(projectId, runId ?? undefined)
  await markRunSucceededAndNotify(task, result)
  return result
}

export async function handleCanvasVideos(task: TaskRow, workerConfig: WorkerConfig): Promise<Record<string, unknown>> {
  const projectId = task.projectId!
  const runId = await markRunRunningAndNotify(task)
  await getService().generateVideos(projectId, providerConfig(workerConfig), runId ?? undefined)
  await markRunSucceededAndNotify(task)
  return { phase: 'videos', projectId }
}
