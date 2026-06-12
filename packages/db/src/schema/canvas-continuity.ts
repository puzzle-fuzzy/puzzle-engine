import type { ContinuityIssue } from '../domain-types'
import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

/**
 * Canvas 连续性报告表 — 阶段 7 校验结果
 *
 * 关联：canvas_projects（每次校验生成一条报告）
 * 用途：规则引擎检查相邻镜头的连续性错误（缺失引用、禁止角度、180度规则、动作/情绪不连续）
 * 查询：按 projectId + createdAt DESC 获取最新报告
 * 不调用 LLM：纯规则校验，无 AI 成本
 */
export const canvasContinuityReports = pgTable('canvas_continuity_reports', {
  /** 主键，UUID 自动生成 */
  id: uuid('id').defaultRandom().primaryKey(),
  /** 所属项目，外键 → canvas_projects.id */
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  /** 校验发现的问题列表（severity/code/message/suggestion） */
  issuesJson: jsonb('issues_json').$type<ContinuityIssue[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
