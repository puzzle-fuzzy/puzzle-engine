import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

/**
 * 工作流状态
 */
export const workflowStatusEnum = pgEnum('workflow_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'cancelled',
])

/**
 * 工作流步骤状态
 */
export const workflowStepStatusEnum = pgEnum('workflow_step_status', [
  'pending',
  'running',
  'completed',
  'failed',
  'skipped',
])

/**
 * 工作流表 — 通用流水线定义和执行实例
 *
 * 替代 canvas-specific pipeline，提供通用工作流编排能力。
 * 每个工作流由有序步骤组成，步骤间可定义依赖关系。
 */
export const workflows = pgTable('workflows', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  /** 工作流类型标识（如 'canvas_analysis', 'batch_generate'） */
  type: varchar('type', { length: 100 }).notNull(),
  status: workflowStatusEnum('status').notNull().default('pending'),
  /** 优先级（0=最高，默认 5） */
  priority: integer('priority').notNull().default(5),
  /** 输入参数 JSON */
  input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  /** 输出结果 JSON */
  output: jsonb('output').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  /** 步骤总数（冗余，避免 COUNT 查询） */
  totalSteps: integer('total_steps').notNull().default(0),
  /** 已完成步骤数 */
  completedSteps: integer('completed_steps').notNull().default(0),
  /** 心跳时间戳 — Worker 定期更新，用于恢复扫描 */
  heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_workflows_account_status').on(table.accountId, table.status),
  index('idx_workflows_status_priority').on(table.status, table.priority, table.createdAt),
  index('idx_workflows_heartbeat').on(table.heartbeatAt),
])

/**
 * 工作流步骤表 — 每个步骤的执行状态
 *
 * 步骤按 stepIndex 顺序执行（可并行化扩展）。
 * 每个步骤关联可选的 generationRecordId（链接到现有生成记录）。
 */
export const workflowSteps = pgTable('workflow_steps', {
  id: uuid('id').defaultRandom().primaryKey(),
  workflowId: uuid('workflow_id').references(() => workflows.id, { onDelete: 'cascade' }).notNull(),
  /** 步骤索引（从 0 开始，按顺序执行） */
  stepIndex: integer('step_index').notNull(),
  /** 步骤名称/标识 */
  name: varchar('name', { length: 100 }).notNull(),
  status: workflowStepStatusEnum('status').notNull().default('pending'),
  /** 关联的生成记录（可选） */
  generationRecordId: uuid('generation_record_id'),
  /** 步骤输入参数 */
  input: jsonb('input').$type<Record<string, unknown>>(),
  /** 步骤输出结果 */
  output: jsonb('output').$type<Record<string, unknown>>(),
  errorMessage: text('error_message'),
  /** 重试次数 */
  retryCount: integer('retry_count').notNull().default(0),
  /** 最大重试次数 */
  maxRetries: integer('max_retries').notNull().default(3),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_workflow_steps_workflow').on(table.workflowId, table.stepIndex),
])
