import type { CharacterProfile } from '../domain-types'
import { boolean, index, jsonb, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core'
import { canvasProjects } from './canvas-projects'

export const canvasCharacters = pgTable('canvas_characters', {
  id: uuid('id').defaultRandom().primaryKey(),
  projectId: uuid('project_id').references(() => canvasProjects.id).notNull(),
  name: varchar('name', { length: 200 }).notNull(),
  role: varchar('role', { length: 50 }),
  description: text('description'),
  identityPrompt: text('identity_prompt'),
  negativePrompt: text('negative_prompt'),
  profileJson: jsonb('profile_json').$type<CharacterProfile>(),
  referenceImageUrl: text('reference_image_url'),
  turnaroundSheetUrl: text('turnaround_sheet_url'),
  locked: boolean('locked').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, table => [
  index('idx_canvas_characters_project').on(table.projectId),
])
