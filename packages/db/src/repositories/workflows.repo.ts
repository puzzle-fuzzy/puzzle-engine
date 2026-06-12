import type { WorkflowOutput, WorkflowStepOutput } from '../domain-types'
import type { WorkflowInsert, WorkflowRow, WorkflowStepInsert, WorkflowStepRow } from '../types'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { getDb } from '../db'
import { workflows, workflowSteps } from '../schema'

// ===== Workflows =====

/** 创建工作流及其步骤 — 一次性插入 workflow + steps，自动填充 totalSteps */
export async function createWorkflow(values: WorkflowInsert & { steps: WorkflowStepInsert[] }): Promise<WorkflowRow> {
  const { steps, ...workflowValues } = values
  const db = getDb()

  const [workflow] = await db.insert(workflows).values({
    ...workflowValues,
    totalSteps: steps.length,
  }).returning()

  if (steps.length > 0) {
    await db.insert(workflowSteps).values(
      steps.map((step, i) => ({
        ...step,
        workflowId: workflow!.id,
        stepIndex: step.stepIndex ?? i,
      })),
    )
  }

  return workflow!
}

/** 按 ID 查询单条工作流（不含步骤） */
export async function getWorkflow(id: string): Promise<WorkflowRow | null> {
  const [row] = await getDb()
    .select()
    .from(workflows)
    .where(eq(workflows.id, id))
    .limit(1)
  return row ?? null
}

/** 查询工作流及其所有步骤（按 stepIndex 排序） */
export async function getWorkflowWithSteps(id: string) {
  const workflow = await getWorkflow(id)
  if (!workflow)
    return null
  const steps = await getDb()
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.workflowId, id))
    .orderBy(workflowSteps.stepIndex)
  return { workflow, steps }
}

/** 获取待处理的工作流（按优先级排序） */
export async function getPendingWorkflows(limit = 10): Promise<WorkflowRow[]> {
  return getDb()
    .select()
    .from(workflows)
    .where(inArray(workflows.status, ['pending', 'running']))
    .orderBy(workflows.priority, workflows.createdAt)
    .limit(limit)
}

/** 查找心跳超时的运行中工作流（恢复扫描） */
export async function getStaleWorkflows(timeoutMs: number, limit = 20): Promise<WorkflowRow[]> {
  const cutoff = new Date(Date.now() - timeoutMs)
  return getDb()
    .select()
    .from(workflows)
    .where(and(
      eq(workflows.status, 'running'),
      sql`${workflows.heartbeatAt} IS NULL OR ${workflows.heartbeatAt} < ${cutoff}`,
    ))
    .limit(limit)
}

/** 更新工作流状态，可选附带 output/errorMessage/completedSteps */
export async function updateWorkflowStatus(id: string, status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled', opts?: {
  output?: WorkflowOutput
  errorMessage?: string
  completedSteps?: number
}) {
  await getDb()
    .update(workflows)
    .set({
      status,
      ...(opts?.output !== undefined && { output: opts.output }),
      ...(opts?.errorMessage !== undefined && { errorMessage: opts.errorMessage }),
      ...(opts?.completedSteps !== undefined && { completedSteps: opts.completedSteps }),
      updatedAt: new Date(),
    })
    .where(eq(workflows.id, id))
}

/** 更新心跳（Worker 正在处理） */
export async function heartbeatWorkflow(id: string) {
  await getDb()
    .update(workflows)
    .set({ heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(workflows.id, id))
}

// ===== Workflow Steps =====

/** 按 ID 查询单条工作流步骤 */
export async function getWorkflowStep(id: string): Promise<WorkflowStepRow | null> {
  const [row] = await getDb()
    .select()
    .from(workflowSteps)
    .where(eq(workflowSteps.id, id))
    .limit(1)
  return row ?? null
}

/** 更新工作流步骤状态，running 时自动设置 startedAt，终态时设置 finishedAt */
export async function updateWorkflowStep(id: string, opts: {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  output?: WorkflowStepOutput
  errorMessage?: string
  generationRecordId?: string
}) {
  const updateData: Partial<WorkflowStepInsert> = {
    status: opts.status,
    updatedAt: new Date(),
  }
  if (opts.output !== undefined)
    updateData.output = opts.output
  if (opts.errorMessage !== undefined)
    updateData.errorMessage = opts.errorMessage
  if (opts.generationRecordId !== undefined)
    updateData.generationRecordId = opts.generationRecordId
  if (opts.status === 'running')
    updateData.startedAt = new Date()
  if (opts.status === 'completed' || opts.status === 'failed' || opts.status === 'skipped')
    updateData.finishedAt = new Date()

  await getDb()
    .update(workflowSteps)
    .set(updateData)
    .where(eq(workflowSteps.id, id))
}

/** 查询用户所有工作流，按创建时间倒序排列 */
export async function listWorkflowsByAccount(accountId: string, limit = 20): Promise<WorkflowRow[]> {
  return getDb()
    .select()
    .from(workflows)
    .where(eq(workflows.accountId, accountId))
    .orderBy(desc(workflows.createdAt))
    .limit(limit)
}
