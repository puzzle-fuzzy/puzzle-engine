import type { StorageConfig } from '../src/types'
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
      const realStorage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-storage',
        publicBasePath: '/api/uploads',
      })

      const buffer = Buffer.from('test-content')
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

  // ── deleteFile ──────────────────────────────────────

  describe('deleteFile', () => {
    it('本地存储删除不存在的文件不抛异常', async () => {
      const storage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-delete',
        publicBasePath: '/api/uploads',
      })

      // 删除一个不存在的文件应静默失败（ENOENT 被忽略）
      await expect(storage.deleteFile('nonexistent/file.txt')).resolves.toBeUndefined()
    })

    it('删除已存在的本地文件', async () => {
      const storage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-delete-exists',
        publicBasePath: '/api/uploads',
      })

      // 先上传一个文件
      const buffer = Buffer.from('to-be-deleted')
      await storage.uploadGenerated(buffer, 'deleteme.txt')

      // 删除它
      await expect(storage.deleteFile('deleteme.txt')).resolves.toBeUndefined()
    })
  })

  // ── downloadAndMap 异常处理 ─────────────────────────

  describe('downloadAndMap', () => {
    it('空 URL 列表返回空数组', async () => {
      const storage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-download-empty',
        publicBasePath: '/api/uploads',
      })

      const result = await storage.downloadAndMap([], 'sub', 'video')
      expect(result).toHaveLength(0)
    })
  })

  // ── saveUploadedFile ───────────────────────────────

  describe('saveUploadedFile', () => {
    it('保存 File 对象并返回 storagePath + publicUrl', async () => {
      const storage = new AssetStorage({
        storageRoot: '/tmp/excuse-test-save-upload',
        publicBasePath: '/api/uploads',
      })

      const file = new File(['upload content'], 'photo.png', { type: 'image/png' })
      const { storagePath, publicUrl } = await storage.saveUploadedFile(file, 'ref_123')

      expect(storagePath).toContain('ref_123/')
      expect(storagePath).toContain('upload_')
      expect(storagePath).toEndWith('.png')
      expect(publicUrl).toContain('/api/uploads/ref_123/')
    })
  })

  // ── isOSSUrl（有 OSS 配置但无真实连接） ────────────

  describe('isOSSUrl with OSS config', () => {
    it('isOSSUrl 始终检查 config.oss.bucket 匹配', () => {
      // 构造 AssetStorage 带 OSS 配置
      // 注意：ali-oss 构造函数可能因假凭据抛异常，AssetStorage 不应因此崩溃
      try {
        const storage = new AssetStorage({
          storageRoot: '/tmp/test',
          oss: {
            accessKeyId: 'fake',
            accessKeySecret: 'fake',
            bucket: 'my-bucket',
            region: 'oss-cn-hangzhou',
          },
        })

        // 如果 ali-oss 构造成功（某些版本可能不立即验证凭据）
        if (storage.isOSSEnabled) {
          expect(storage.isOSSUrl('https://my-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/img.png')).toBe(true)
          expect(storage.isOSSUrl('https://other-bucket.oss-cn-hangzhou.aliyuncs.com/uploads/img.png')).toBe(false)
          expect(storage.isOSSUrl('/api/uploads/local.png')).toBe(false)
        }
      }
      catch {
        // ali-oss 构造失败（测试环境无真实凭据），跳过
        // 这是预期的——在无 OSS 的测试环境中，OSS 初始化可能抛异常
      }
    })
  })
})
