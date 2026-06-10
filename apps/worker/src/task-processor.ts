import {
  markGenerationFailed,
  markGenerationSucceeded,
  markGenerationProcessing,
} from '@excuse/db'
import { DashScopeClient, getModelById, AssetStorage } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'
import type { WorkerConfig } from './config'

/**
 * 单条 generation record 的处理结果
 */
export type TaskResult =
  | { action: 'completed'; taskId: string }
  | { action: 'skipped'; taskId: string; reason: string }
  | { action: 'ignored'; taskId: string; status: string }

/**
 * 创建任务处理器
 *
 * 依赖通过参数注入，方便测试时 mock
 */
export function createTaskProcessor(config: WorkerConfig) {
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({ storageRoot: config.storageRoot })

  return { client, storage, processTask }

  /**
   * 处理单条待轮询的任务
   */
  async function processTask(record: {
    id: string
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
      await markGenerationFailed(record.id, 'Task timed out (>4h)')
      return { action: 'completed', taskId }
    }

    // ── 查询 DashScope 任务状态 ───────────────────────
    const taskStatus = await client.queryTask(taskId)

    switch (taskStatus.status) {
      // ── 成功：下载 + 计费 + 更新 ────────────────────
      case 'SUCCEEDED': {
        const savedUrls = await downloadResultUrls(taskStatus.output, taskId)

        const modelConfig = getModelById(record.model)
        const actualCost = modelConfig
          ? calculateCost(modelConfig, record.inputParams as Record<string, unknown>, {
              videoDuration: (record.inputParams as any)?.duration || 5,
            })
          : record.cost

        const videoUrl = extractVideoUrl(taskStatus.output)

        await markGenerationSucceeded(record.id, {
          ...(taskStatus.output || {}),
          savedUrls,
          originalUrl: videoUrl,
        }, actualCost as Record<string, unknown> | undefined)

        return { action: 'completed', taskId }
      }

      // ── 失败 ────────────────────────────────────────
      case 'FAILED': {
        await markGenerationFailed(record.id, taskStatus.errorMessage || 'DashScope task failed')
        return { action: 'completed', taskId }
      }

      // ── 仍在处理中 ──────────────────────────────────
      case 'PENDING':
      case 'RUNNING': {
        if (record.status === 'pending') {
          await markGenerationProcessing(record.id)
        }
        return { action: 'skipped', taskId, reason: `still ${taskStatus.status}` }
      }

      default:
        return { action: 'ignored', taskId, status: taskStatus.status }
    }
  }

  /**
   * 从 DashScope 输出中提取视频 URL 并下载保存
   */
  async function downloadResultUrls(
    output: Record<string, unknown> | undefined,
    taskId: string,
  ): Promise<string[]> {
    const videoUrl = extractVideoUrl(output)
    if (!videoUrl) return []
    return storage.downloadAndMap([videoUrl], taskId, 'video')
  }
}

// ── 工具函数 ────────────────────────────────────────────

function extractVideoUrl(output: Record<string, unknown> | undefined): string | undefined {
  if (!output) return undefined
  return (output as any).video_url || (output as any).results?.[0]?.url
}
