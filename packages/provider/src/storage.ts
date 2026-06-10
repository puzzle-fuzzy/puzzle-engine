import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { StorageConfig } from './types'

/**
 * 文件存储服务
 * - 开发环境：保存到本地目录，通过静态文件服务访问
 * - 生产环境：上传到阿里云 OSS（预留，后续实现）
 */
export class AssetStorage {
  private config: StorageConfig

  constructor(config: StorageConfig) {
    this.config = config
  }

  /**
   * 下载远程文件并保存到本地存储
   * @param url 远程文件 URL（DashScope 临时 URL，24h 过期）
   * @param subDir 子目录（如 taskId）
   * @param fileName 文件名
   * @returns 本地相对路径
   */
  async downloadAndSave(url: string, subDir: string, fileName: string): Promise<string> {
    const dir = join(this.config.storageRoot, subDir)
    await mkdir(dir, { recursive: true })

    const filePath = join(dir, fileName)
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
    }

    const buffer = await response.arrayBuffer()
    await writeFile(filePath, Buffer.from(buffer))

    return `uploads/${subDir}/${fileName}`
  }

  /**
   * 获取文件的公开访问 URL
   */
  getPublicUrl(relativePath: string): string {
    const base = this.config.publicBasePath || '/api/uploads'
    return `${base}/${relativePath}`
  }

  /**
   * 从 URL 中提取文件扩展名
   */
  static getExtensionFromUrl(url: string): string {
    try {
      const pathname = new URL(url).pathname
      const ext = pathname.split('.').pop()?.toLowerCase()
      if (ext && ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mp3', 'wav'].includes(ext)) {
        return ext
      }
    }
    catch {}
    return 'bin'
  }

  /**
   * 生成唯一文件名
   */
  static generateFileName(prefix: string, ext: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${timestamp}_${random}.${ext}`
  }

  /**
   * 保存上传的文件
   */
  async saveUploadedFile(file: File, subDir: string): Promise<{ storagePath: string; publicUrl: string }> {
    const dir = join(this.config.storageRoot, subDir)
    await mkdir(dir, { recursive: true })

    const ext = file.name.split('.').pop() || 'bin'
    const fileName = AssetStorage.generateFileName('upload', ext)
    const filePath = join(dir, fileName)

    const buffer = await file.arrayBuffer()
    await writeFile(filePath, Buffer.from(buffer))

    const relativePath = `${subDir}/${fileName}`
    return {
      storagePath: relativePath,
      publicUrl: this.getPublicUrl(relativePath),
    }
  }
}
