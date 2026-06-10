import { Elysia } from 'elysia'
import { createUploadedFile } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import type { ServerConfig } from '../config'
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

      const formData = body as FormData
      const file = formData.get('file') as File | null
      if (!file) {
        return { success: false, error: 'No file provided' }
      }

      const subDir = `ref_${Date.now()}`
      const { storagePath, publicUrl } = await storage.saveUploadedFile(file, subDir)

      // 创建上传文件记录
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
    })
}
