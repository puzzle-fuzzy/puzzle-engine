import type { CanvasLocationInsert } from '../types'
import { and, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasLocations } from '../schema/canvas-locations'
import { canvasProjects } from '../schema/canvas-projects'

/** 创建场景记录 */
export async function createCanvasLocation(values: CanvasLocationInsert) {
  const [location] = await getDb().insert(canvasLocations).values(values).returning()
  return location!
}

/** 按 ID 查询场景 */
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

/** 列出项目所有场景 */
export async function listCanvasLocationsByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasLocations)
    .where(eq(canvasLocations.projectId, projectId))
}

/** 批量删除项目场景，excludeLocked=true 时保留已锁定的场景 */
export async function deleteCanvasLocationsByProject(projectId: string, { excludeLocked = false } = {}) {
  const conditions = [eq(canvasLocations.projectId, projectId)]
  if (excludeLocked)
    conditions.push(eq(canvasLocations.locked, false))
  await getDb().delete(canvasLocations).where(and(...conditions))
}

/** 更新场景属性（部分更新，自动刷新 updatedAt） */
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

/** 按 ID 删除单个场景 */
export async function deleteCanvasLocationById(id: string) {
  await getDb().delete(canvasLocations).where(eq(canvasLocations.id, id))
}
