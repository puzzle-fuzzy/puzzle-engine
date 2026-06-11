import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'

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
