import type { UploadedFileDTO } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { forbidden, notFound, unauthorized, validationError } from '../utils/errors'

const ALLOWED_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB

/**
 * DB row → DTO 序列化（Date → string）
 *
 * 上传文件 DTO 必须包含 createdAt 等 Date 字段的字符串序列化，
 * 与 GenerationRecord / AuthUser 保持一致的模式。
 */
function serializeUploadedFile(record: {
  id: string
  accountId: string
  fileName: string
  fileSize: number
  mimeType: string
  storagePath: string
  publicUrl: string
  purpose: string
  metadata: Record<string, unknown> | null
  createdAt: Date
}): UploadedFileDTO {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
  }
}

export function createUploadRoutes(config: ServerConfig) {
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  return new Elysia({ prefix: '/api' })
    .use(createAuthPlugin(config))
    // 文件上传
    .post('/upload', async ({ body, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }

      const file = body.file
      if (!file) {
        return validationError(set, 'No file provided')
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return validationError(set, `不支持的文件类型: ${file.type}，仅允许 PNG/JPEG/WebP/GIF`)
      }

      if (file.size > MAX_FILE_SIZE) {
        return validationError(set, `文件大小超过限制（最大 ${MAX_FILE_SIZE / 1024 / 1024}MB）`)
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
        file: serializeUploadedFile(record),
      }
    }, {
      body: t.Object({
        file: t.File({ description: '上传的文件' }),
      }),
    })

    // 删除上传文件
    .delete('/upload/:id', async ({ params: { id }, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }

      const record = await getUploadedFileById(id)
      if (!record) {
        return notFound(set, '文件不存在')
      }
      if (record.accountId !== userId) {
        return forbidden(set, '无权删除该文件')
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
