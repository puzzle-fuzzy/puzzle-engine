import type { CostDetail, OutputResult } from '../domain-types'
import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 生成内容类别枚举
 * - text:   文本生成
 * - image:  图片生成
 * - video:  视频生成
 */
export const generationCategoryEnum = pgEnum('generation_category', ['text', 'image', 'video'])

/**
 * 生成任务状态枚举
 * - pending:    等待处理
 * - processing: 处理中
 * - succeeded:  生成成功
 * - failed:     生成失败
 */
export const generationStatusEnum = pgEnum('generation_status', ['pending', 'processing', 'succeeded', 'failed'])

/**
 * 生成记录表 — 记录每次 AI 模型调用的完整生命周期
 *
 * 关联：accounts（每条记录属于一个用户）
 * 流程：pending → processing → succeeded / failed
 * 计费：cost 字段记录 token 用量和费用
 */
export const generationRecords = pgTable('generation_records', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),

  /** 所属用户，外键 → accounts.id */
  accountId: uuid('account_id').references(() => accounts.id).notNull(),

  /** 异步任务 ID，用于轮询/回调追踪（如百炼taskId） */
  taskId: varchar('task_id', { length: 255 }).unique(),

  /** 使用的 AI 模型标识，如 wanx-v1、qwen-vl 等 */
  model: varchar('model', { length: 100 }).notNull(),

  /** 生成内容类别：text / image / video / audio */
  category: generationCategoryEnum('category').notNull(),

  /** 任务状态，默认 pending */
  status: generationStatusEnum('status').notNull().default('pending'),

  /** 输入参数（prompt、参考图、配置等） */
  inputParams: jsonb('input_params').notNull().$type<Record<string, unknown>>(),

  /** 输出结果（生成的 URL、文本内容等） */
  outputResult: jsonb('output_result').$type<OutputResult>(),

  /** 费用明细（token 数量、单价、总费用等） */
  cost: jsonb('cost').$type<CostDetail>(),

  /** 失败时的错误信息 */
  errorMessage: text('error_message'),

  /** 重试次数，每次 retry 时递增 */
  retryCount: integer('retry_count').default(0).notNull(),

  /** 去重键 = model + hash(params)，防止同参数重复提交 */
  dedupeKey: varchar('dedupe_key', { length: 255 }).unique(),

  /** 创建时间 */
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),

  /** 最后更新时间（状态变更时更新） */
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_gen_records_account_created').on(table.accountId, table.createdAt),
  index('idx_gen_records_status_category').on(table.status, table.category),
])
