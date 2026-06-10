import {
  pollPendingVideoTasks,
  markGenerationFailed,
  markGenerationSucceeded,
  markGenerationProcessing,
} from '@excuse/db'
import { DashScopeClient, getModelById, AssetStorage } from '@excuse/provider'
import { calculateCost } from '@excuse/billing'

const config = {
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
  storageRoot: process.env.STORAGE_ROOT || './uploads',
  pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000,
  staleTimeoutMs: 4 * 60 * 60 * 1000, // 4 hours
}

const client = new DashScopeClient({
  apiKey: config.dashscopeApiKey,
  baseUrl: config.dashscopeBaseUrl,
})
const storage = new AssetStorage({ storageRoot: config.storageRoot })

async function pollPendingTasks(): Promise<number> {
  // 查询所有处理中的视频任务
  const records = await pollPendingVideoTasks()

  let processed = 0

  for (const record of records) {
    const taskId = record.taskId
    if (!taskId) continue

    // 检查是否超时
    const elapsed = Date.now() - new Date(record.createdAt).getTime()
    if (elapsed > config.staleTimeoutMs) {
      await markGenerationFailed(record.id, 'Task timed out (>4h)')

      console.log(`⏰ Task ${taskId} timed out`)
      processed++
      continue
    }

    // 查询 DashScope 任务状态
    const taskStatus = await client.queryTask(taskId)

    switch (taskStatus.status) {
      case 'SUCCEEDED': {
        // 下载视频文件
        const results = (taskStatus.output as any)?.results || []
        const videoUrl = (taskStatus.output as any)?.video_url || results[0]?.url

        let savedUrls: string[] = []
        if (videoUrl) {
          try {
            const ext = AssetStorage.getExtensionFromUrl(videoUrl)
            const fileName = AssetStorage.generateFileName('video', ext)
            const relativePath = await storage.downloadAndSave(videoUrl, taskId, fileName)
            savedUrls = [storage.getPublicUrl(relativePath)]
          }
          catch (err) {
            console.error(`Failed to download video for task ${taskId}:`, err)
            savedUrls = [videoUrl]
          }
        }

        // 计算实际费用
        const modelConfig = getModelById(record.model)
        const actualCost = modelConfig
          ? calculateCost(modelConfig, record.inputParams as Record<string, unknown>, {
              videoDuration: (record.inputParams as any)?.duration || 5,
            })
          : record.cost

        await markGenerationSucceeded(record.id, {
          ...(taskStatus.output || {}),
          savedUrls,
          originalUrl: videoUrl,
        }, actualCost as Record<string, unknown> | undefined)

        console.log(`✅ Task ${taskId} completed`)
        processed++
        break
      }

      case 'FAILED': {
        await markGenerationFailed(record.id, taskStatus.errorMessage || 'DashScope task failed')

        console.log(`❌ Task ${taskId} failed: ${taskStatus.errorMessage}`)
        processed++
        break
      }

      case 'PENDING':
      case 'RUNNING': {
        // 更新状态为 processing（如果还是 pending）
        if (record.status === 'pending') {
          await markGenerationProcessing(record.id)
        }
        break
      }

      default: {
        console.log(`⚠️ Task ${taskId} unknown status: ${taskStatus.status}`)
      }
    }
  }

  return processed
}

async function main() {
  console.log('🤖 Worker started, polling interval:', config.pollIntervalMs, 'ms')

  while (true) {
    try {
      const count = await pollPendingTasks()
      if (count > 0) {
        console.log(`📊 Processed ${count} tasks`)
      }
    }
    catch (error) {
      console.error('Worker poll error:', error)
    }

    await Bun.sleep(config.pollIntervalMs)
  }
}

main()
