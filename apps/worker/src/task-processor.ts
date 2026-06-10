import {
  markGenerationFailed,
  markGenerationSucceeded,
  markGenerationProcessing,
  notifyGenerationStatus,
} from '@excuse/db'
import { DashScopeClient, getModelById, AssetStorage } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'
import type { GenerationNotifyPayload } from '@excuse/shared'
import type { WorkerConfig } from './config'

/**
 * 单条 generation record 的处理结果
 */
export type TaskResult =
  | { action: 'completed'; taskId: string }
  | { action: 'skipped'; taskId: string; reason: string }
  | { action: 'ignored'; taskId: string; status: string }

/**
 * 可注入的外部依赖（测试时替换）
 */
export interface TaskProcessorDeps {
  queryTask: (taskId: string) => Promise<{
    status: string
    output?: Record<string, unknown>
    errorMessage?: string
  }>
  downloadAndMap: (urls: string[], subDir: string, prefix: string) => Promise<string[]>
  markGenerationFailed: (id: string, message: string) => Promise<void>
  markGenerationSucceeded: (id: string, output: Record<string, unknown>, cost?: Record<string, unknown>) => Promise<void>
  markGenerationProcessing: (id: string) => Promise<void>
  notifyGenerationStatus: (payload: GenerationNotifyPayload) => Promise<void>
}

/**
 * 创建任务处理器
 *
 * @param config Worker 配置
 * @param deps 可选的外部依赖注入（测试时使用）
 */
export function createTaskProcessor(config: WorkerConfig, deps?: Partial<TaskProcessorDeps>) {
  // 生产环境：用真实依赖
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  const queryTask = deps?.queryTask ?? ((id: string) => client.queryTask(id))
  const downloadAndMap = deps?.downloadAndMap ?? ((urls, subDir, prefix) => storage.downloadAndMap(urls, subDir, prefix))
  const fail = deps?.markGenerationFailed ?? markGenerationFailed
  const succeed = deps?.markGenerationSucceeded ?? markGenerationSucceeded
  const processing = deps?.markGenerationProcessing ?? markGenerationProcessing
  const notify = deps?.notifyGenerationStatus ?? notifyGenerationStatus

  return { processTask }

  /**
   * 处理单条待轮询的任务
   */
  async function processTask(record: {
    id: string
    accountId: string
    taskId: string | null
    model: string
    status: string
    category: string
    createdAt: Date
    inputParams: Record<string, unknown> | null
    cost: Record<string, unknown> | null
  }): Promise<TaskResult> {
    const taskId = record.taskId
    if (!taskId) {
      return { action: 'skipped', taskId: record.id, reason: 'no taskId' }
    }

    // ── 超时检测 ──────────────────────────────────────
    const elapsed = Date.now() - new Date(record.createdAt).getTime()
    if (elapsed > config.staleTimeoutMs) {
      await fail(record.id, 'Task timed out (>4h)')
      await notify({
        accountId: record.accountId,
        recordId: record.id,
        status: 'failed',
        category: record.category,
        model: record.model,
        taskId,
        errorMessage: 'Task timed out (>4h)',
      })
      return { action: 'completed', taskId }
    }

    // ── 查询 DashScope 任务状态 ───────────────────────
    const taskStatus = await queryTask(taskId)

    switch (taskStatus.status) {
      // ── 成功：下载 + 计费 + 更新 ────────────────────
      case 'SUCCEEDED': {
        const videoUrl = extractVideoUrl(taskStatus.output)
        const savedUrls = videoUrl
          ? await downloadAndMap([videoUrl], taskId, 'video')
          : []

        const modelConfig = getModelById(record.model)
        const actualCost = modelConfig
          ? calculateCost(modelConfig, record.inputParams as Record<string, unknown>, {
              videoDuration: (record.inputParams as any)?.duration || 5,
            })
          : record.cost

        const output = {
          ...(taskStatus.output || {}),
          savedUrls,
          originalUrl: videoUrl,
        }

        await succeed(record.id, output, actualCost as Record<string, unknown> | undefined)

        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'succeeded',
          category: record.category,
          model: record.model,
          taskId,
          outputResult: output,
          cost: actualCost as Record<string, unknown> | undefined,
        })

        return { action: 'completed', taskId }
      }

      // ── 失败 ────────────────────────────────────────
      case 'FAILED': {
        const errMsg = taskStatus.errorMessage || 'DashScope task failed'
        await fail(record.id, errMsg)
        await notify({
          accountId: record.accountId,
          recordId: record.id,
          status: 'failed',
          category: record.category,
          model: record.model,
          taskId,
          errorMessage: errMsg,
        })
        return { action: 'completed', taskId }
      }

      // ── 仍在处理中 ──────────────────────────────────
      case 'PENDING':
      case 'RUNNING': {
        if (record.status === 'pending') {
          await processing(record.id)
        }
        return { action: 'skipped', taskId, reason: `still ${taskStatus.status}` }
      }

      default:
        return { action: 'ignored', taskId, status: taskStatus.status }
    }
  }
}

// ── 工具函数 ────────────────────────────────────────────

export function extractVideoUrl(output: Record<string, unknown> | undefined): string | undefined {
  if (!output) return undefined
  // HappyHorse / 万相 2.7：output.video_url
  const videoUrl = (output as any).video_url
  if (videoUrl) return videoUrl
  // 图片异步任务：output.results[0].url
  const results = (output as any).results
  if (Array.isArray(results) && results.length > 0) {
    return results[0].url || results[0].b64_image
  }
  return undefined
}
