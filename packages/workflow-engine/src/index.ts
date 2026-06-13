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
