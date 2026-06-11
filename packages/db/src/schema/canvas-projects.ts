import { boolean, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'

export const canvasProjectStatusEnum = pgEnum('canvas_project_status', [
  'draft',
  'analyzed',
  'characters_ready',
  'locations_ready',
  'refs_ready',
  'storyboard_ready',
  'continuity_checked',
  'prompts_ready',
  'generating',
  'completed',
  'failed',
])

export const canvasProjects = pgTable('canvas_projects', {
  id: uuid('id').defaultRandom().primaryKey(),
  accountId: uuid('account_id').references(() => accounts.id).notNull(),
  title: varchar('title', { length: 500 }),
  storyText: text('story_text').notNull(),
  status: canvasProjectStatusEnum('status').notNull().default('draft'),
  analysisJson: jsonb('analysis_json').$type<Record<string, unknown>>(),
  modelPreferencesJson: jsonb('model_preferences_json').$type<Record<string, string>>(),
  canvasLayout: jsonb('canvas_layout').$type<Record<string, unknown>>(),
  isDeleted: boolean('is_deleted').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
