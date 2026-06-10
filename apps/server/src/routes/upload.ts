import { Elysia } from 'elysia'
import { createUploadedFile } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import type { ServerConfig } from '../config'

export function createUploadRoutes(config: ServerConfig) {
  const storage = new AssetStorage({ storageRoot: config.storageRoot })

  return new Elysia({ prefix: '/api' })
    // 文件上传
    .post('/upload', async ({ body }) => {
      const formData = body as FormData
      const file = formData.get('file') as File | null
      if (!file) {
        return { success: false, error: 'No file provided' }
      }

      const subDir = `ref_${Date.now()}`
      const { storagePath, publicUrl } = await storage.saveUploadedFile(file, subDir)

      // TODO: 接入认证后使用真实 accountId
      const record = await createUploadedFile({
        accountId: '00000000-0000-0000-0000-000000000000',
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
