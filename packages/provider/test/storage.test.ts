import type { StorageConfig } from '../src/types'
import { mkdir, writeFile } from 'node:fs/promises'
import { beforeEach, describe, expect, it } from 'bun:test'
import { AssetStorage } from '../src/storage'

// ── 静态方法测试（无 IO） ─────────────────────────────────

describe('AssetStorage 静态方法', () => {
  describe('getExtensionFromUrl', () => {
    it('从 URL 中提取常见图片扩展名', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/path/image.jpg')).toBe('jpg')
      expect(AssetStorage.getExtensionFromUrl('https://example.com/img.png?token=abc')).toBe('png')
      expect(AssetStorage.getExtensionFromUrl('https://cdn.com/photo.webp')).toBe('webp')
    })

    it('从 URL 中提取视频扩展名', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/video.mp4')).toBe('mp4')
      expect(AssetStorage.getExtensionFromUrl('https://example.com/clip.webm')).toBe('webm')
    })

    it('从 URL 中提取音频扩展名', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/audio.mp3')).toBe('mp3')
      expect(AssetStorage.getExtensionFromUrl('https://example.com/sound.wav')).toBe('wav')
    })

    it('未知扩展名返回 bin', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/file.xyz')).toBe('bin')
    })

    it('无扩展名返回 bin', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/noext')).toBe('bin')
    })

    it('无效 URL 返回 bin', () => {
      expect(AssetStorage.getExtensionFromUrl('not-a-url')).toBe('bin')
      expect(AssetStorage.getExtensionFromUrl('')).toBe('bin')
    })

    it('大小写不敏感', () => {
      expect(AssetStorage.getExtensionFromUrl('https://example.com/IMG.JPG')).toBe('jpg')
      expect(AssetStorage.getExtensionFromUrl('https://example.com/Clip.MP4')).toBe('mp4')
    })
  })

  describe('inferContentType', () => {
    it('图片格式映射正确', () => {
      expect(AssetStorage.inferContentType('jpg')).toBe('image/jpeg')
      expect(AssetStorage.inferContentType('jpeg')).toBe('image/jpeg')
      expect(AssetStorage.inferContentType('png')).toBe('image/png')
      expect(AssetStorage.inferContentType('gif')).toBe('image/gif')
      expect(AssetStorage.inferContentType('webp')).toBe('image/webp')
    })

    it('视频格式映射正确', () => {
      expect(AssetStorage.inferContentType('mp4')).toBe('video/mp4')
      expect(AssetStorage.inferContentType('webm')).toBe('video/webm')
    })

    it('音频格式映射正确', () => {
      expect(AssetStorage.inferContentType('mp3')).toBe('audio/mpeg')
      expect(AssetStorage.inferContentType('wav')).toBe('audio/wav')
    })

    it('未知格式返回 undefined', () => {
      expect(AssetStorage.inferContentType('xyz')).toBeUndefined()
      expect(AssetStorage.inferContentType('bin')).toBeUndefined()
    })
  })

  describe('generateFileName', () => {
    it('生成正确格式的文件名', () => {
      const name = AssetStorage.generateFileName('img', 'png')
      // 格式: img_<timestamp>_<random>.png
      expect(name).toMatch(/^img_\d+_[a-z0-9]+\.png$/)
    })

    it('不同调用生成不同文件名', () => {
      const name1 = AssetStorage.generateFileName('prefix', 'jpg')
      const name2 = AssetStorage.generateFileName('prefix', 'jpg')
      // 由于时间戳或随机数不同，两次调用应产生不同的文件名
      // （极端情况下相同，但概率极低）
      expect(name1).not.toBe(name2)
    })
  })
})

// ── AssetStorage 实例测试（mock 文件系统） ─────────────────

describe('AssetStorage 实例方法', () => {
  const localConfig: StorageConfig = {
    storageRoot: '/tmp/test-uploads',
    publicBasePath: '/api/uploads',
  }

  describe('无 OSS 配置（纯本地）', () => {
    let storage: AssetStorage

    beforeEach(() => {
      storage = new AssetStorage(localConfig)
    })

    it('isOSSEnabled 为 false', () => {
      expect(storage.isOSSEnabled).toBe(false)
    })

    it('isOSSUrl 返回 false', () => {
      expect(storage.isOSSUrl('https://example.com/file.png')).toBe(false)
    })

    it('uploadGenerated 保存本地文件并返回本地 URL', async () => {
      const buffer = Buffer.from('test-content')

      // mock mkdir 和 writeFile
      const _originalMkdir = mkdir
      const _originalWriteFile = writeFile

      const { mkdir: _rm } = await import('node:fs/promises')
      // 用临时目录实际测试（/tmp 在所有系统上可写）
      const realStorage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-storage',
        publicBasePath: '/api/uploads',
      })

      const url = await realStorage.uploadGenerated(buffer, 'test/file.txt')
      expect(url).toBe('/api/uploads/test/file.txt')
    })
  })

  describe('getLocalPublicUrl', () => {
    it('使用默认 publicBasePath', async () => {
      const storage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-url',
      })

      const buffer = Buffer.from('hello')
      const url = await storage.uploadGenerated(buffer, 'dir/name.txt')
      expect(url).toBe('/api/uploads/dir/name.txt')
    })
  })
})
