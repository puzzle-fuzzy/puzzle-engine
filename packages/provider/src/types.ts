export interface DashScopeConfig {
  apiKey: string
  baseUrl?: string
}

export interface ProviderResult {
  success: boolean
  providerTaskId?: string
  output?: Record<string, unknown>
  usage?: {
    inputTokens?: number
    outputTokens?: number
    imageCount?: number
    videoDuration?: number
  }
  error?: string
}

export interface TaskStatus {
  taskId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  output?: Record<string, unknown>
  usage?: Record<string, unknown>
  errorCode?: string
  errorMessage?: string
}

export interface StorageConfig {
  storageRoot: string
  publicBasePath?: string
  oss?: {
    accessKeyId: string
    accessKeySecret: string
    bucket: string
    region: string
    endpoint: string
    uploadPrefix: string
    generatedPrefix: string
  }
}
