import type { ContinuityIssue } from '../domain-types'
import { jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

export const canvasContinuityReports = pgTable('canvas_continuity_reports', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  issuesJson: jsonb('issues_json').$type<ContinuityIssue[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})
