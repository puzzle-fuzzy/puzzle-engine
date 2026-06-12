import type { CanvasContinuityRow, CanvasProjectInsert } from '../types'
import { and, desc, eq, inArray } from 'drizzle-orm'
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

/** 批量获取项目详情 — 5 条 SQL 替代 1+N*5 条 */
export async function batchGetProjectDetails(accountId: string) {
  const projects = await listCanvasProjectsByAccount(accountId)
  if (projects.length === 0)
    return []

  const projectIds = projects.map(p => p.id)

  const [characters, locations, shots, continuityReports] = await Promise.all([
    getDb().select().from(canvasCharacters).where(inArray(canvasCharacters.projectId, projectIds)),
    getDb().select().from(canvasLocations).where(inArray(canvasLocations.projectId, projectIds)),
    getDb().select().from(canvasShots).where(inArray(canvasShots.projectId, projectIds)).orderBy(canvasShots.shotIndex),
    getDb().select().from(canvasContinuityReports).where(inArray(canvasContinuityReports.projectId, projectIds)).orderBy(desc(canvasContinuityReports.createdAt)),
  ])

  const charMap = new Map<string, typeof characters>()
  for (const c of characters) {
    const arr = charMap.get(c.projectId) ?? []
    arr.push(c)
    charMap.set(c.projectId, arr)
  }

  const locMap = new Map<string, typeof locations>()
  for (const l of locations) {
    const arr = locMap.get(l.projectId) ?? []
    arr.push(l)
    locMap.set(l.projectId, arr)
  }

  const shotMap = new Map<string, typeof shots>()
  for (const s of shots) {
    const arr = shotMap.get(s.projectId) ?? []
    arr.push(s)
    shotMap.set(s.projectId, arr)
  }

  const contMap = new Map<string, CanvasContinuityRow>()
  for (const c of continuityReports) {
    if (!contMap.has(c.projectId))
      contMap.set(c.projectId, c)
  }

  return projects.map(p => ({
    project: p,
    characters: charMap.get(p.id) ?? [],
    locations: locMap.get(p.id) ?? [],
    shots: shotMap.get(p.id) ?? [],
    latestContinuity: contMap.get(p.id) ?? null,
  }))
}
