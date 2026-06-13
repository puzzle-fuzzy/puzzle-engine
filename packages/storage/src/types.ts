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

export interface StoredObjectResult {
  storagePath: string
  publicUrl: string
  providerUrl?: string
  mimeType?: string
  sizeBytes?: number
  checksum?: string
}
