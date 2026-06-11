import type { CanvasContinuityInsert } from '../types'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasContinuityReports } from '../schema/canvas-continuity'

export async function createContinuityReport(values: CanvasContinuityInsert) {
  const [report] = await getDb().insert(canvasContinuityReports).values(values).returning()
  return report!
}

export async function getLatestContinuityReport(projectId: string) {
  const [report] = await getDb()
    .select()
    .from(canvasContinuityReports)
    .where(eq(canvasContinuityReports.projectId, projectId))
    .orderBy(desc(canvasContinuityReports.createdAt))
    .limit(1)
  return report ?? null
}
