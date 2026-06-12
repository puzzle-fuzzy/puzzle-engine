import type { CanvasPipelinePhase, CanvasPipelineRunInsert } from '../types'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '../db'
import { canvasPipelineRuns } from '../schema/canvas-pipeline-runs'

/** 创建流水线运行记录 — 每个 phase 每次执行对应一条 run */
export async function createPipelineRun(values: CanvasPipelineRunInsert) {
  const [run] = await getDb().insert(canvasPipelineRuns).values(values).returning()
  return run!
}

/** 按 ID 查询单条流水线运行记录 */
export async function getPipelineRunById(id: string) {
  const [run] = await getDb()
    .select()
    .from(canvasPipelineRuns)
    .where(eq(canvasPipelineRuns.id, id))
    .limit(1)
  return run ?? null
}

/** 查询项目下所有流水线运行记录，按创建时间倒序排列 */
export async function listPipelineRunsByProject(projectId: string) {
  return getDb()
    .select()
    .from(canvasPipelineRuns)
    .where(eq(canvasPipelineRuns.projectId, projectId))
    .orderBy(desc(canvasPipelineRuns.createdAt))
}

/** 并发守卫：查找同一项目同一阶段中正在执行或排队中的 run，防止重复提交 */
export async function findActiveRunForPhase(projectId: string, phase: CanvasPipelinePhase) {
  const [run] = await getDb()
    .select()
    .from(canvasPipelineRuns)
    .where(and(
      eq(canvasPipelineRuns.projectId, projectId),
      eq(canvasPipelineRuns.phase, phase),
      inArray(canvasPipelineRuns.status, ['pending', 'running']),
    ))
    .limit(1)
  return run ?? null
}

/** Mark run as running — only succeeds if current status is 'pending' (append-only guard) */
export async function markPipelineRunRunning(id: string, inputSnapshot?: Record<string, unknown>) {
  const [updated] = await getDb()
    .update(canvasPipelineRuns)
    .set({
      status: 'running',
      startedAt: new Date(),
      ...(inputSnapshot && { inputSnapshotJson: inputSnapshot }),
    })
    .where(and(eq(canvasPipelineRuns.id, id), eq(canvasPipelineRuns.status, 'pending')))
    .returning()
  return updated ?? null
}

/** Mark run as succeeded — only succeeds if current status is 'running' (append-only guard) */
export async function markPipelineRunSucceeded(id: string, outputSummary?: Record<string, unknown>) {
  const [updated] = await getDb()
    .update(canvasPipelineRuns)
    .set({
      status: 'succeeded',
      finishedAt: new Date(),
      ...(outputSummary && { outputSummaryJson: outputSummary }),
    })
    .where(and(eq(canvasPipelineRuns.id, id), eq(canvasPipelineRuns.status, 'running')))
    .returning()
  return updated ?? null
}

/** Mark run as failed — only succeeds if current status is 'running' (append-only guard) */
export async function markPipelineRunFailed(id: string, errorMessage: string) {
  const [updated] = await getDb()
    .update(canvasPipelineRuns)
    .set({
      status: 'failed',
      finishedAt: new Date(),
      errorMessage,
    })
    .where(and(eq(canvasPipelineRuns.id, id), eq(canvasPipelineRuns.status, 'running')))
    .returning()
  return updated ?? null
}

/** Mark run as cancelled — only succeeds if current status is 'pending' or 'running' (append-only guard) */
export async function markPipelineRunCancelled(id: string) {
  const [updated] = await getDb()
    .update(canvasPipelineRuns)
    .set({
      status: 'cancelled',
      finishedAt: new Date(),
    })
    .where(and(eq(canvasPipelineRuns.id, id), inArray(canvasPipelineRuns.status, ['pending', 'running'])))
    .returning()
  return updated ?? null
}
