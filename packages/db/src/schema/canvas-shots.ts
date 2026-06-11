import { integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasLocations } from './canvas-locations'
import { canvasProjects } from './canvas-projects'

export const canvasShotStatusEnum = pgEnum('canvas_shot_status', [
  'draft',
  'ready',
  'generating',
  'completed',
  'failed',
])

export const canvasShots = pgTable('canvas_shots', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  shotIndex: integer('shot_index').notNull(),
  duration: integer('duration').default(5).notNull(),
  locationId: uuid('location_id').references(() => canvasLocations.id),
  characterIdsJson: jsonb('character_ids_json').$type<string[]>().default([]).notNull(),
  narrative: text('narrative').notNull(),
  cameraJson: jsonb('camera_json').$type<Record<string, unknown>>().notNull(),
  continuityJson: jsonb('continuity_json').$type<Record<string, unknown>>().notNull(),
  timelineJson: jsonb('timeline_json').$type<Array<{ time: string, action: string }>>(),
  environmentJson: jsonb('environment_json').$type<Record<string, unknown>>(),
  videoPrompt: text('video_prompt'),
  negativePrompt: text('negative_prompt'),
  videoTaskId: varchar('video_task_id', { length: 255 }),
  videoUrl: text('video_url'),
  status: canvasShotStatusEnum('status').default('draft').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})
