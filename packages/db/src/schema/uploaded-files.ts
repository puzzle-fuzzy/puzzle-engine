import { bigint, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 上传文件表 — 用户上传的参考图片、素材等文件
 *
 * 关联：accounts（每个文件属于一个用户）
 * 存储：storage_path（本地/云存储路径） + public_url（访问地址）
 * 用途：purpose 字段区分文件类型，默认 reference（参考图）
 */
export const uploadedFiles = pgTable('uploaded_files', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),

  /** 所属用户，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),

  /** 原始文件名 */
  fileName: varchar('file_name', { length: 500 }).notNull(),

  /** 文件大小（字节） */
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),

  /** MIME 类型，如 image/png */
  mimeType: varchar('mime_type', { length: 100 }).notNull(),

  /** 存储路径（本地路径或云存储 key） */
  storagePath: text('storage_path').notNull(),

  /** 公开访问 URL */
  publicUrl: text('public_url').notNull(),

  /**
   * 文件用途，默认 reference（参考图）
   * 可扩展：reference / avatar / output 等
   */
  purpose: varchar('purpose', { length: 50 }).default('reference').notNull(),

  /** 额外元数据（宽高、格式信息等） */
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),

  /** 上传时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
