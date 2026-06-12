import type { LocationProfile } from '../domain-types'
import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

/**
 * Canvas 场景表 — AI 视频流水线中的场景档案
 *
 * 关联：canvas_projects（每个场景属于一个项目）
 * 生命周期：由 LLM 阶段 3（locations）生成，用户可手动编辑
 * 级联规则：场景删除时自动清理引用该场景的镜头（清空 locationId）
 * 锁定：locked=true 时重新分析不会覆盖该场景数据
 * 参考图约束：AI 生成的空场景图强制无人无角色
 */
export const canvasLocations = pgTable('canvas_locations', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 场景名称（从故事中提取或用户指定） */
  name: varchar('name', { length: 200 }).notNull(),
  /** 场景类型：interior（室内）/ exterior（室外）/ mixed（混合），默认 mixed */
  type: varchar('type', { length: 50 }).default('mixed').notNull(),
  /** LLM 生成的完整视觉档案（色调、光影、建筑、摄影规则等） */
  profileJson: jsonb('profile_json').$type<LocationProfile>(),
  /** 场景正面提示词（用于 AI 生图时的环境一致性） */
  scenePrompt: text('scene_prompt'),
  /** 负面提示词（生图时排除的元素，如人物） */
  negativePrompt: text('negative_prompt'),
  /** 空场景参考图 URL（阶段 5 locationRefs 生成） */
  referenceImageUrl: text('reference_image_url'),
  /** 是否锁定 — locked=true 时重新分析不覆盖，保护用户手动编辑 */
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_locations_project').on(table.projectId),
])
