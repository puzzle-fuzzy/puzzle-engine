import type { CanvasCharacterInsert } from '../types'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasCharacters } from '../schema/canvas-characters'

export async function createCanvasCharacter(values: CanvasCharacterInsert) {
  const [character] = await getDb().insert(canvasCharacters).values(values).returning()
  return character!
}

export async function getCanvasCharacterById(id: string) {
  const [character] = await getDb()
    .select()
    .from(canvasCharacters)
    .where(eq(canvasCharacters.id, id))
    .limit(1)
  return character ?? null
}

export async function listCanvasCharactersByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasCharacters)
    .where(eq(canvasCharacters.projectId, projectId))
}

export async function deleteCanvasCharactersByProject(projectId: string, { excludeLocked = false } = {}) {
  const conditions = [eq(canvasCharacters.projectId, projectId)]
  if (excludeLocked)
    conditions.push(eq(canvasCharacters.locked, false))
  await getDb().delete(canvasCharacters).where(and(...conditions))
}

export async function updateCanvasCharacter(
  id: string,
  values: Partial<Pick<CanvasCharacterInsert, 'name' | 'role' | 'description' | 'identityPrompt' | 'negativePrompt' | 'profileJson' | 'referenceImageUrl' | 'turnaroundSheetUrl' | 'locked'>>,
) {
  const [updated] = await getDb()
    .update(canvasCharacters)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasCharacters.id, id))
    .returning()
  return updated ?? null
}

export async function deleteCanvasCharacterById(id: string) {
  await getDb().delete(canvasCharacters).where(eq(canvasCharacters.id, id))
}
