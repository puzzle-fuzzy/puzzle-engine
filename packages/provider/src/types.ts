import type { DashScopeUsage } from './dashscope-types'

export interface DashScopeConfig {
  apiKey: string
  baseUrl?: string
}

export interface ProviderUsage {
  inputTokens?: number
  outputTokens?: number
  imageCount?: number
  videoDuration?: number
}

export interface TextProviderOutput extends Record<string, unknown> {
  type: 'text'
  text: string
  raw: unknown
}

export interface ImageProviderOutput extends Record<string, unknown> {
  type: 'image'
  urls: string[]
  raw: unknown
}

export interface VideoTaskProviderOutput extends Record<string, unknown> {
  type: 'processing'
  taskId: string
  status: 'submitted'
  raw: unknown
}

export interface TextProviderResult {
  type: 'text'
  success: true
  model: string
  output: TextProviderOutput
  usage?: ProviderUsage
}

export interface ImageProviderResult {
  type: 'image'
  success: true
  model: string
  output: ImageProviderOutput
  usage?: ProviderUsage
}

export interface VideoTaskProviderResult {
  type: 'video_task'
  success: true
  model: string
  taskId: string
  output: VideoTaskProviderOutput
  usage?: ProviderUsage
}

export interface FailedProviderResult {
  type: 'failed'
  success: false
  model?: string
  error: string
}

export type ProviderResult
  = | TextProviderResult
    | ImageProviderResult
    | VideoTaskProviderResult
    | FailedProviderResult

export interface TaskStatus {
  taskId: string
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN'
  output?: Record<string, unknown>
  usage?: DashScopeUsage
  errorCode?: string
  errorMessage?: string
}

export interface OSSConfig {
  accessKeyId: string
  accessKeySecret: string
  bucket: string
  region: string
  endpoint?: string
  uploadPrefix?: string
  generatedPrefix?: string
}

export interface StorageConfig {
  storageRoot: string
  publicBasePath?: string
  oss?: OSSConfig
}
