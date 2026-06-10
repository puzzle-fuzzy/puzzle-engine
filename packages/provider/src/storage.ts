/// <reference path="./ali-oss.d.ts" />
import OSS from 'ali-oss'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { logger } from '@excuse/shared'
import type { StorageConfig } from './types'

/**
 * 文件存储服务
 * - OSS 已配置：上传到阿里云 OSS，同时保留本地副本
 * - OSS 未配置：仅保存到本地目录
 */
export class AssetStorage {
  private config: StorageConfig
  private ossClient: OSS | null = null

  constructor(config: StorageConfig) {
    this.config = config
    if (config.oss) {
      this.initOSS(config.oss)
    }
  }

  // ── OSS 初始化 ────────────────────────────────────────

  private initOSS(oss: NonNullable<StorageConfig['oss']>) {
    this.ossClient = new OSS({
      accessKeyId: oss.accessKeyId,
      accessKeySecret: oss.accessKeySecret,
      bucket: oss.bucket,
      region: oss.region,
      endpoint: oss.endpoint || undefined,
    })
  }

  get isOSSEnabled(): boolean {
    return this.ossClient !== null
  }

  // ── 核心上传方法 ──────────────────────────────────────

  /**
   * 上传 buffer 到 OSS（generated 前缀）+ 本地副本
   * @returns OSS 公开 URL，OSS 不可用时返回本地路径
   */
  async uploadGenerated(buffer: Buffer, fileName: string, contentType?: string): Promise<string> {
    // 总是保存本地副本
    await this.saveLocal(buffer, fileName)

    if (!this.ossClient) {
      return this.getLocalPublicUrl(fileName)
    }

    const prefix = this.config.oss?.generatedPrefix || 'generated'
    const key = `${prefix}/${fileName}`

    try {
      await this.ossClient.put(key, buffer, {
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
      return this.getOSSPublicUrl(key)
    }
    catch (err) {
      logger.warn({ err, key, prefix: 'generated' }, 'OSS upload failed, falling back to local')
      return this.getLocalPublicUrl(fileName)
    }
  }

  /**
   * 上传 buffer 到 OSS（upload 前缀）+ 本地副本
   * 用于用户主动上传的文件（参考图等）
   */
  async uploadUserFile(buffer: Buffer, fileName: string, contentType?: string): Promise<string> {
    await this.saveLocal(buffer, fileName)

    if (!this.ossClient) {
      return this.getLocalPublicUrl(fileName)
    }

    const prefix = this.config.oss?.uploadPrefix || 'uploads'
    const key = `${prefix}/${fileName}`

    try {
      await this.ossClient.put(key, buffer, {
        headers: contentType ? { 'Content-Type': contentType } : undefined,
      })
      return this.getOSSPublicUrl(key)
    }
    catch (err) {
      logger.warn({ err, key, prefix: 'upload' }, 'OSS upload failed, falling back to local')
      return this.getLocalPublicUrl(fileName)
    }
  }

  // ── 下载 + 上传一体化方法 ─────────────────────────────

  /**
   * 下载远程文件并上传到 OSS + 保存本地
   * @param url 远程 URL（DashScope 临时 URL，24h 过期）
   * @param fileName 最终文件名（含子目录）
   * @returns OSS 公开 URL 或本地路径
   */
  async downloadAndUpload(url: string, fileName: string): Promise<string> {
    const buffer = await this.downloadToBuffer(url)
    const ext = AssetStorage.getExtensionFromUrl(url)
    const contentType = AssetStorage.inferContentType(ext)
    return this.uploadGenerated(buffer, fileName, contentType)
  }

  /**
   * 批量下载远程 URL，上传到 OSS，返回公开 URL 列表
   *
   * 用于 DashScope 生成结果（图片/视频）的下载保存。
   * 单个 URL 下载失败时保留原始临时 URL 作为兜底。
   *
   * @param urls 远程文件 URL 数组
   * @param subDir 子目录（如 taskId）
   * @param prefix 文件名前缀（如 'img_0', 'video'）
   * @returns 公开访问 URL 数组
   */
  async downloadAndMap(urls: string[], subDir: string, prefix: string): Promise<string[]> {
    const result: string[] = []
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i]!
      try {
        const ext = AssetStorage.getExtensionFromUrl(url)
        const fileName = `${subDir}/${AssetStorage.generateFileName(`${prefix}_${i}`, ext)}`
        const publicUrl = await this.downloadAndUpload(url, fileName)
        result.push(publicUrl)
      }
      catch {
        result.push(url) // 下载失败则保留原 URL
      }
    }
    return result
  }

  // ── 保存上传的文件 ────────────────────────────────────

  async saveUploadedFile(file: File, subDir: string): Promise<{ storagePath: string; publicUrl: string }> {
    const ext = file.name.split('.').pop() || 'bin'
    const baseName = AssetStorage.generateFileName('upload', ext)
    const fileName = `${subDir}/${baseName}`
    const buffer = Buffer.from(await file.arrayBuffer())
    const contentType = file.type || AssetStorage.inferContentType(ext)

    const publicUrl = await this.uploadUserFile(buffer, fileName, contentType)

    return {
      storagePath: fileName,
      publicUrl,
    }
  }

  // ── URL 工具方法 ──────────────────────────────────────

  /**
   * 检查 URL 是否为 OSS URL
   */
  isOSSUrl(url: string): boolean {
    if (!this.config.oss) return false
    return url.includes(`${this.config.oss.bucket}.aliyuncs.com`)
  }

  // ── 私有辅助方法 ──────────────────────────────────────

  private async downloadToBuffer(url: string): Promise<Buffer> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to download: ${response.status} ${response.statusText}`)
    }
    return Buffer.from(await response.arrayBuffer())
  }

  private async saveLocal(buffer: Buffer, fileName: string): Promise<void> {
    const dir = join(this.config.storageRoot, dirname(fileName))
    await mkdir(dir, { recursive: true })
    await writeFile(join(this.config.storageRoot, fileName), buffer)
  }

  private getLocalPublicUrl(fileName: string): string {
    const base = this.config.publicBasePath || '/api/uploads'
    return `${base}/${fileName}`
  }

  private getOSSPublicUrl(key: string): string {
    const oss = this.config.oss!
    return `https://${oss.bucket}.${oss.region}.aliyuncs.com/${key}`
  }

  // ── 静态工具方法 ──────────────────────────────────────

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

  static generateFileName(prefix: string, ext: string): string {
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    return `${prefix}_${timestamp}_${random}.${ext}`
  }

  static inferContentType(ext: string): string | undefined {
    const map: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
    }
    return map[ext]
  }
}
