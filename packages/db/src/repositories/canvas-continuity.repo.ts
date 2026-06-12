import type { CanvasContinuityInsert } from '../types'
import { desc, eq } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasContinuityReports } from '../schema/canvas-continuity'

/** 创建连续性校验报告（阶段 7 校验结果） */
export async function createContinuityReport(values: CanvasContinuityInsert) {
  const [report] = await getDb().insert(canvasContinuityReports).values(values).returning()
  return report!
}

/** 获取项目最新的连续性校验报告（按 createdAt DESC 取第一条） */
export async function getLatestContinuityReport(projectId: string) {
  const [report] = await getDb()
    .select()
    .from(canvasContinuityReports)
    .where(eq(canvasContinuityReports.projectId, projectId))
    .orderBy(desc(canvasContinuityReports.createdAt))
    .limit(1)
  return report ?? null
}
