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

  if (CANVAS_PAUSE_BEFORE.has(nextPhase)) {
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
