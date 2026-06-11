import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

export function createUploadRoutes(config: ServerConfig) {
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  return new Elysia({ prefix: '/api' })
    .use(createAuthPlugin(config))
    // 文件上传
    .post('/upload', async ({ body, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }

      const file = body.file
      if (!file) {
        return { success: false, error: 'No file provided' }
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return { success: false, error: `不支持的文件类型: ${file.type}，仅允许 PNG/JPEG/WebP/GIF` }
      }

      if (file.size > MAX_FILE_SIZE) {
        return { success: false, error: `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）` }
      }

      const subDir = `ref_${Date.now()}`
      const { storagePath, publicUrl } = await storage.saveUploadedFile(file, subDir)

      const record = await createUploadedFile({
        accountId: userId,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        storagePath,
        publicUrl,
        purpose: 'reference',
      })

      return {
        success: true,
        file: {
          id: record.id,
          fileName: record.fileName,
          publicUrl: record.publicUrl,
          mimeType: record.mimeType,
        },
      }
    }, {
      body: t.Object({
        file: t.File({ description: '上传的文件' }),
      }),
    })

    // 删除上传文件
    .delete('/upload/:id', async ({ params: { id }, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }

      const record = await getUploadedFileById(id)
      if (!record) {
        return { success: false, error: '文件不存在' }
      }
      if (record.accountId !== userId) {
        return { success: false, error: '无权删除该文件' }
      }

      // Delete from storage then from DB
      await storage.deleteFile(record.storagePath)
      await deleteUploadedFileById(id)

      return { success: true }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })
}
