import type { CanvasShotInsert } from '../types'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasShots } from '../schema/canvas-shots'

export async function createCanvasShot(values: CanvasShotInsert) {
  const [shot] = await getDb().insert(canvasShots).values(values).returning()
  return shot!
}

export async function batchCreateCanvasShots(valuesList: CanvasShotInsert[]) {
  return getDb().insert(canvasShots).values(valuesList).returning()
}

export async function getCanvasShotById(id: string) {
  const [shot] = await getDb()
    .select()
    .from(canvasShots)
    .where(eq(canvasShots.id, id))
    .limit(1)
  return shot ?? null
}

export async function listCanvasShotsByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasShots)
    .where(eq(canvasShots.projectId, projectId))
    .orderBy(asc(canvasShots.shotIndex))
}

export async function deleteCanvasShotsByProject(projectId: string) {
  await getDb().delete(canvasShots).where(eq(canvasShots.projectId, projectId))
}

export async function updateCanvasShot(
  id: string,
  values: Partial<Pick<CanvasShotInsert, 'shotIndex' | 'duration' | 'locationId' | 'characterIdsJson' | 'narrative' | 'cameraJson' | 'continuityJson' | 'timelineJson' | 'environmentJson' | 'videoPrompt' | 'negativePrompt' | 'videoTaskId' | 'videoUrl' | 'status' | 'errorMessage'>>,
) {
  const [updated] = await getDb()
    .update(canvasShots)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(canvasShots.id, id))
    .returning()
  return updated ?? null
}

export async function listPendingVideoShots(projectId: string) {
  return getDb()
    .select()
    .from(canvasShots)
    .where(
      and(
        eq(canvasShots.projectId, projectId),
        inArray(canvasShots.status, ['generating']),
      ),
    )
}

export async function deleteCanvasShotById(id: string) {
  await getDb().delete(canvasShots).where(eq(canvasShots.id, id))
}
