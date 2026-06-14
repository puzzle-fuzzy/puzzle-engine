export type CanvasPipelinePhase
  = | 'analyze'
    | 'characters'
    | 'locations'
    | 'characterRefs'
    | 'locationRefs'
    | 'storyboard'
    | 'continuity'
    | 'rebuild'
    | 'videos'

export type CanvasAutoAdvanceSkipReason
  = | 'not_canvas_task'
    | 'unknown_phase'
    | 'last_phase'
    | 'auto_progress_disabled'
    | 'pause_before'

export interface CanvasTaskRef {
  type: string
  domain: string
  projectId: string | null
  accountId: string | null
}

export interface CanvasAutoAdvanceDecision {
  shouldAdvance: boolean
  currentPhase: CanvasPipelinePhase | null
  nextPhase: CanvasPipelinePhase | null
  reason?: CanvasAutoAdvanceSkipReason
}

export interface CanvasPipelineTaskAdapter<TRun extends { id: string }, TTask extends { id: string }> {
  createPipelineRun: (values: {
    projectId: string
    phase: CanvasPipelinePhase
    createdBy: string
  }) => Promise<TRun> | TRun
  createTask: (values: {
    accountId: string
    type: `canvas.${CanvasPipelinePhase}`
    domain: 'canvas'
    priority: number
    projectId: string
    targetType: 'pipeline_run'
    targetId: string
  }) => Promise<TTask> | TTask
  linkPipelineRunToTask: (runId: string, taskId: string) => Promise<unknown> | unknown
}

export interface CreateNextCanvasPipelineTaskInput<TRun extends { id: string }, TTask extends { id: string }> {
  projectId: string
  accountId: string
  nextPhase: CanvasPipelinePhase
  adapter: CanvasPipelineTaskAdapter<TRun, TTask>
}

export interface CreateNextCanvasPipelineTaskResult {
  runId: string
  taskId: string
  taskType: `canvas.${CanvasPipelinePhase}`
}

export const CANVAS_PHASE_ORDER: readonly CanvasPipelinePhase[] = [
  'analyze',
  'characters',
  'locations',
  'characterRefs',
  'locationRefs',
  'storyboard',
  'continuity',
  'rebuild',
  'videos',
]

export const CANVAS_PAUSE_BEFORE: ReadonlySet<CanvasPipelinePhase> = new Set([
  'storyboard',
  'videos',
])

/** 阶段是否需要用户确认才能继续（storyboard / videos） */
export function isPauseBeforePhase(phase: CanvasPipelinePhase): boolean {
  return CANVAS_PAUSE_BEFORE.has(phase)
}

export function phaseToTaskType(phase: CanvasPipelinePhase): `canvas.${CanvasPipelinePhase}` {
  return `canvas.${phase}`
}

export async function createNextCanvasPipelineTask<TRun extends { id: string }, TTask extends { id: string }>(
  input: CreateNextCanvasPipelineTaskInput<TRun, TTask>,
): Promise<CreateNextCanvasPipelineTaskResult> {
  const run = await input.adapter.createPipelineRun({
    projectId: input.projectId,
    phase: input.nextPhase,
    createdBy: input.accountId,
  })

  const taskType = phaseToTaskType(input.nextPhase)
  const task = await input.adapter.createTask({
    accountId: input.accountId,
    type: taskType,
    domain: 'canvas',
    priority: 5,
    projectId: input.projectId,
    targetType: 'pipeline_run',
    targetId: run.id,
  })

  await input.adapter.linkPipelineRunToTask(run.id, task.id)

  return {
    runId: run.id,
    taskId: task.id,
    taskType,
  }
}

export function getCanvasPhaseFromTaskType(taskType: string): CanvasPipelinePhase | null {
  if (!taskType.startsWith('canvas.'))
    return null

  const phase = taskType.slice('canvas.'.length) as CanvasPipelinePhase
  return isCanvasPipelinePhase(phase) ? phase : null
}

export function getNextCanvasPhase(currentPhase: CanvasPipelinePhase): CanvasPipelinePhase | null {
  const index = CANVAS_PHASE_ORDER.indexOf(currentPhase)
  if (index === -1 || index === CANVAS_PHASE_ORDER.length - 1)
    return null
  return CANVAS_PHASE_ORDER[index + 1]!
}

export function decideCanvasAutoAdvance(
  task: CanvasTaskRef,
  autoProgress: boolean,
): CanvasAutoAdvanceDecision {
  if (task.domain !== 'canvas' || !task.projectId || !task.accountId) {
    return {
      shouldAdvance: false,
      currentPhase: null,
      nextPhase: null,
      reason: 'not_canvas_task',
    }
  }

  const currentPhase = getCanvasPhaseFromTaskType(task.type)
  if (!currentPhase) {
    return {
      shouldAdvance: false,
      currentPhase: null,
      nextPhase: null,
      reason: 'unknown_phase',
    }
  }

  const nextPhase = getNextCanvasPhase(currentPhase)
  if (!nextPhase) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase: null,
      reason: 'last_phase',
    }
  }

  if (!autoProgress) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase,
      reason: 'auto_progress_disabled',
    }
  }

  if (isPauseBeforePhase(nextPhase)) {
    return {
      shouldAdvance: false,
      currentPhase,
      nextPhase,
      reason: 'pause_before',
    }
  }

  return {
    shouldAdvance: true,
    currentPhase,
    nextPhase,
  }
}

function isCanvasPipelinePhase(value: string): value is CanvasPipelinePhase {
  return CANVAS_PHASE_ORDER.includes(value as CanvasPipelinePhase)
}

// ===== Canvas pipeline run 状态规则 =====
// 纯状态判断，不依赖 DB/provider/server/worker runtime。
// PipelineRunStatus 镜像 @excuse/db 的 canvasPipelineRunStatusEnum（不 import，避免反向依赖）。

export type PipelineRunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** 活跃状态 — 排队或执行中，可被取消、可阻止同阶段重复提交 */
export const CANVAS_ACTIVE_RUN_STATUSES: readonly PipelineRunStatus[] = ['pending', 'running']

/** 终态 — 成功/失败/取消，状态不再变化 */
export const CANVAS_TERMINAL_RUN_STATUSES: readonly PipelineRunStatus[] = ['succeeded', 'failed', 'cancelled']

/** 可重试终态 — failed 或 cancelled（succeeded 不可重试，active 需先取消） */
export const CANVAS_RETRYABLE_RUN_STATUSES: readonly PipelineRunStatus[] = ['failed', 'cancelled']

/** 最小 run 形状 — 只要求 status，便于对 DB 行或任意结构体复用规则 */
export interface PipelineRunLike {
  status: PipelineRunStatus
}

/** run 是否处于活跃状态（pending 或 running） */
export function isActivePipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_ACTIVE_RUN_STATUSES.includes(run.status)
}

/** run 是否处于终态（succeeded/failed/cancelled） */
export function isTerminalPipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_TERMINAL_RUN_STATUSES.includes(run.status)
}

/** run 是否可重新提交（failed 或 cancelled） */
export function isRetryablePipelineRun<T extends PipelineRunLike>(run: T): boolean {
  return CANVAS_RETRYABLE_RUN_STATUSES.includes(run.status)
}

/** 从 run 列表中筛出活跃 run，保留原始元素类型与顺序 */
export function filterActivePipelineRuns<T extends PipelineRunLike>(runs: readonly T[]): T[] {
  return runs.filter(isActivePipelineRun)
}

/** canAdvanceToPhase 选项 */
export interface CanAdvanceToPhaseOptions {
  /** 目标阶段是否已存在活跃 run（并发守卫） */
  hasActiveRun?: boolean
}

/**
 * 在已确定要自动推进的前提下，判断能否真正创建/执行目标阶段。
 *
 * 阻止条件：目标阶段是 pause-before（需用户确认），或已有活跃 run（并发守卫）。
 * 不关心 autoProgress —— 那是更上层的 decideCanvasAutoAdvance 职责。
 */
export function canAdvanceToPhase(phase: CanvasPipelinePhase, opts: CanAdvanceToPhaseOptions = {}): boolean {
  if (isPauseBeforePhase(phase))
    return false
  if (opts.hasActiveRun)
    return false
  return true
}
