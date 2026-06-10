import type { OSSConfig } from '@excuse/provider'

export interface WorkerConfig {
  /** DashScope API Key */
  dashscopeApiKey: string
  /** DashScope API Base URL */
  dashscopeBaseUrl: string
  /** 本地文件存储根目录 */
  storageRoot: string
  /** 轮询间隔（毫秒） */
  pollIntervalMs: number
  /** 任务超时时间（毫秒） */
  staleTimeoutMs: number
  /** OSS 配置（可选） */
  oss: OSSConfig | undefined
}

/**
 * 从环境变量读取并构建 Worker 配置
 */
export function loadConfig(): WorkerConfig {
  return {
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: process.env.STORAGE_ROOT || './uploads',
    pollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000,
    staleTimeoutMs: Number(process.env.WORKER_STALE_TIMEOUT_MS) || 4 * 60 * 60 * 1000, // 4h
    oss: loadOSSConfig(),
  }
}

function loadOSSConfig(): OSSConfig | undefined {
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  const bucket = process.env.OSS_BUCKET
  const region = process.env.OSS_REGION

  if (!accessKeyId || !accessKeySecret || !bucket || !region) {
    return undefined
  }

  return {
    accessKeyId,
    accessKeySecret,
    bucket,
    region,
    endpoint: process.env.OSS_ENDPOINT || undefined,
    uploadPrefix: process.env.OSS_UPLOAD_PREFIX || 'uploads',
    generatedPrefix: process.env.OSS_GENERATED_PREFIX || 'generated',
  }
}
