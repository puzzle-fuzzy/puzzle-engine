import type { MutationOkResponse, UploadedFileDTO, UploadResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { createUploadedFile, deleteUploadedFileById, getUploadedFileById } from '@excuse/db'
import { AssetStorage } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'
import { audit } from '../services/audit'
import { forbidden, notFound, validationError } from '../utils/errors'

const ALLOWED_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  // 字幕功能支持的视频格式
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-msvideo',
]
const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB（视频文件更大）

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
    .use(createRequireAuthPlugin(config))
    // 文件上传
    .post('/upload', async ({ body, userId, set }) => {
      const file = body.file
      if (!file) {
        return validationError(set, 'No file provided')
      }

      if (!ALLOWED_MIME_TYPES.includes(file.type)) {
        return validationError(set, `不支持的文件类型: ${file.type}，仅允许 PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI`)
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
        data: serializeUploadedFile(record),
      } satisfies UploadResponse
    }, {
      body: t.Object({
        file: t.File({ description: '上传的文件' }),
      }),
      detail: {
        summary: '上传文件',
        description: '上传图片或视频文件（PNG/JPEG/WebP/GIF/MP4/WebM/MOV/AVI，最大 200MB），保存到存储并创建 DB 记录',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })

    // 删除上传文件
    .delete('/upload/:id', async ({ params: { id }, userId, set }) => {
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

      audit('file_delete', { accountId: userId, targetId: id })

      return { success: true } satisfies MutationOkResponse
    }, {
      params: t.Object({
        id: t.String(),
      }),
      detail: {
        summary: '删除上传文件',
        description: '删除指定文件（需为文件所有者）。同时从存储和数据库中移除。',
        tags: ['上传'],
        security: [{ bearerAuth: [] }],
      },
    })
}
