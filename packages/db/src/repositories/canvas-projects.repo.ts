import type { CanvasProjectInsert } from '../types'
import { and, desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasCharacters } from '../schema/canvas-characters'
import { canvasContinuityReports } from '../schema/canvas-continuity'
import { canvasLocations } from '../schema/canvas-locations'
import { canvasProjects } from '../schema/canvas-projects'
import { canvasShots } from '../schema/canvas-shots'

export async function createCanvasProject(values: CanvasProjectInsert) {
  const [project] = await getDb().insert(canvasProjects).values(values).returning()
  return project!
}

export async function getCanvasProjectById(id: string) {
  const [project] = await getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return project ?? null
}

/**
 * 按 ID + accountId 查询项目，用于 owner 校验
 */
export async function getCanvasProjectByIdForAccount(id: string, accountId: string) {
  const [project] = await getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.id, id), eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .limit(1)
  return project ?? null
}

export async function listCanvasProjectsByAccount(accountId: string) {
  return getDb()
    .select()
    .from(canvasProjects)
    .where(and(eq(canvasProjects.accountId, accountId), eq(canvasProjects.isDeleted, false)))
    .orderBy(desc(canvasProjects.createdAt))
}

export async function updateCanvasProject(
  id: string,
  values: Partial<Omit<CanvasProjectInsert, 'id' | 'accountId' | 'createdAt' | 'updatedAt'>>,
) {
  const [updated] = await getDb()
    .update(canvasProjects)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasProjects.id, id))
    .returning()
  return updated ?? null
}

export async function softDeleteCanvasProject(id: string) {
  await getDb()
    .update(canvasProjects)
    .set({ isDeleted: true, updatedAt: new Date() })
    .where(eq(canvasProjects.id, id))
}

/** 获取项目完整详情（含关联的角色、场景、分镜、最新连续性报告） */
export async function getCanvasProjectDetail(id: string) {
  const project = await getCanvasProjectById(id)
  if (!project)
    return null

  const [characters, locations, shots, continuityReports] = await Promise.all([
    getDb().select().from(canvasCharacters).where(eq(canvasCharacters.projectId, id)),
    getDb().select().from(canvasLocations).where(eq(canvasLocations.projectId, id)),
    getDb().select().from(canvasShots).where(eq(canvasShots.projectId, id)).orderBy(canvasShots.shotIndex),
    getDb()
      .select()
      .from(canvasContinuityReports)
      .where(eq(canvasContinuityReports.projectId, id))
      .orderBy(desc(canvasContinuityReports.createdAt))
      .limit(1),
  ])

  return { project, characters, locations, shots, latestContinuity: continuityReports[0] ?? null }
}
