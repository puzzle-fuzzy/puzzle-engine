import type { CanvasLocationInsert } from '../types'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasLocations } from '../schema/canvas-locations'
import { canvasProjects } from '../schema/canvas-projects'

export async function createCanvasLocation(values: CanvasLocationInsert) {
  const [location] = await getDb().insert(canvasLocations).values(values).returning()
  return location!
}

export async function getCanvasLocationById(id: string) {
  const [location] = await getDb()
    .select()
    .from(canvasLocations)
    .where(eq(canvasLocations.id, id))
    .limit(1)
  return location ?? null
}

/**
 * 校验 location 属于指定用户的项目。返回 location 或 null。
 */
export async function getCanvasLocationForAccount(locationId: string, accountId: string) {
  const [row] = await getDb()
    .select({ location: canvasLocations, projectAccountId: canvasProjects.accountId })
    .from(canvasLocations)
    .innerJoin(canvasProjects, eq(canvasLocations.projectId, canvasProjects.id))
    .where(and(eq(canvasLocations.id, locationId), eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return row?.location ?? null
}

export async function listCanvasLocationsByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasLocations)
    .where(eq(canvasLocations.projectId, projectId))
}

export async function deleteCanvasLocationsByProject(projectId: string, { excludeLocked = false } = {}) {
  const conditions = [eq(canvasLocations.projectId, projectId)]
  if (excludeLocked)
    conditions.push(eq(canvasLocations.locked, false))
  await getDb().delete(canvasLocations).where(and(...conditions))
}

export async function updateCanvasLocation(
  id: string,
  values: Partial<Pick<CanvasLocationInsert, 'name' | 'type' | 'profileJson' | 'scenePrompt' | 'negativePrompt' | 'referenceImageUrl' | 'locked'>>,
) {
  const [updated] = await getDb()
    .update(canvasLocations)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasLocations.id, id))
    .returning()
  return updated ?? null
}

export async function deleteCanvasLocationById(id: string) {
  await getDb().delete(canvasLocations).where(eq(canvasLocations.id, id))
}
