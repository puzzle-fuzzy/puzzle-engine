import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { accounts } from './accounts'
import { canvasProjects } from './canvas-projects'

export const canvasPipelinePhaseEnum = pgEnum('canvas_pipeline_phase', [
  'analyze',
  'characters',
  'locations',
  'characterRefs',
  'locationRefs',
  'storyboard',
  'continuity',
  'rebuild',
  'videos',
])

export const canvasPipelineRunStatusEnum = pgEnum('canvas_pipeline_run_status', [
  'pending',
  'running',
  'succeeded',
  'failed',
  'cancelled',
])

export const canvasPipelineRuns = pgTable('canvas_pipeline_runs', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  phase: canvasPipelinePhaseEnum('phase').notNull(),
  status: canvasPipelineRunStatusEnum('status').notNull().default('pending'),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  createdBy: uuid('created_by').references(() => accounts.id),
  inputSnapshotJson: jsonb('input_snapshot_json').$type<Record<string, unknown>>(),
  outputSummaryJson: jsonb('output_summary_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_pipeline_runs_project_phase_status').on(table.projectId, table.phase, table.status),
  index('idx_pipeline_runs_project_created').on(table.projectId, table.createdAt),
])
