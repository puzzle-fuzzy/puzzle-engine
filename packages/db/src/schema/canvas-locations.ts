import type { LocationProfile } from '../domain-types'
import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

export const canvasLocations = pgTable('canvas_locations', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  type: varchar('type', { length: 50 }).default('mixed').notNull(),
  profileJson: jsonb('profile_json').$type<LocationProfile>(),
  scenePrompt: text('scene_prompt'),
  negativePrompt: text('negative_prompt'),
  referenceImageUrl: text('reference_image_url'),
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_locations_project').on(table.projectId),
])
