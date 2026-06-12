import type { CharacterProfile } from '../domain-types'
import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

/**
 * Canvas 角色表 — AI 视频流水线中的角色档案
 *
 * 关联：canvas_projects（每个角色属于一个项目）
 * 生命周期：由 LLM 阶段 2（characters）生成，用户可手动编辑
 * 级联规则：角色删除时自动清理引用该角色的镜头（从 characterIdsJson 移除）
 * 锁定：locked=true 时重新分析不会覆盖该角色数据
 */
export const canvasCharacters = pgTable('canvas_characters', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 角色名称（从故事中提取或用户指定） */
  name: varchar('name', { length: 200 }).notNull(),
  /** 角色类型（protagonist / antagonist / supporting 等） */
  role: varchar('role', { length: 50 }),
  /** 角色文字描述（外貌、性格等） */
  description: text('description'),
  /** 正面提示词（用于 AI 生图时的角色一致性） */
  identityPrompt: text('identity_prompt'),
  /** 负面提示词（生图时排除的特征） */
  negativePrompt: text('negative_prompt'),
  /** LLM 生成的完整视觉档案（外貌、服装、配饰等） */
  profileJson: jsonb('profile_json').$type<CharacterProfile>(),
  /** 角色正面肖像参考图 URL（阶段 4 characterRefs 生成） */
  referenceImageUrl: text('reference_image_url'),
  /** 三视图（turnaround sheet）URL（阶段 4 生成，含正面/侧面/背面） */
  turnaroundSheetUrl: text('turnaround_sheet_url'),
  /** 是否锁定 — locked=true 时重新分析不覆盖，保护用户手动编辑 */
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_characters_project').on(table.projectId),
])
