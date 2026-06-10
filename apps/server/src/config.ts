import type { OSSConfig } from '@excuse/provider'

export interface ServerConfig {
  port: number
  databaseUrl: string
  dashscopeApiKey: string
  dashscopeBaseUrl: string
  storageRoot: string
  frontendUrl: string
  workerPollIntervalMs: number
  jwtSecret: string
  jwtExpiresIn: string
  oss: OSSConfig | undefined
}

export function loadConfig(): ServerConfig {
  console.log('Loading server configuration...', process.env.DASHSCOPE_API_KEY)
  return {
    port: Number(process.env.PORT) || 5007,
    databaseUrl: process.env.DATABASE_URL || 'postgres://excuse:excuse_dev@localhost:5433/excuse',
    dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
    dashscopeBaseUrl: process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/api/v1',
    storageRoot: process.env.STORAGE_ROOT || './uploads',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:8007',
    workerPollIntervalMs: Number(process.env.WORKER_POLL_INTERVAL_MS) || 5000,
    jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
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
