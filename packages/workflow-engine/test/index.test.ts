import { describe, expect, it } from 'bun:test'
import {
  CANVAS_PAUSE_BEFORE,
  CANVAS_PHASE_ORDER,
  decideCanvasAutoAdvance,
  getCanvasPhaseFromTaskType,
  getNextCanvasPhase,
  phaseToTaskType,
} from '../src'

describe('@excuse/workflow-engine', () => {
  it('defines the canonical canvas phase order', () => {
    expect(CANVAS_PHASE_ORDER).toEqual([
      'analyze',
      'characters',
      'locations',
      'characterRefs',
      'locationRefs',
      'storyboard',
      'continuity',
      'rebuild',
      'videos',
    ])
    expect(CANVAS_PAUSE_BEFORE.has('storyboard')).toBe(true)
    expect(CANVAS_PAUSE_BEFORE.has('videos')).toBe(true)
  })

  it('maps between phases and canvas task types', () => {
    expect(phaseToTaskType('characters')).toBe('canvas.characters')
    expect(getCanvasPhaseFromTaskType('canvas.characters')).toBe('characters')
    expect(getCanvasPhaseFromTaskType('canvas.unknown')).toBeNull()
    expect(getCanvasPhaseFromTaskType('generate.video')).toBeNull()
  })

  it('returns the next phase when one exists', () => {
    expect(getNextCanvasPhase('analyze')).toBe('characters')
    expect(getNextCanvasPhase('rebuild')).toBe('videos')
    expect(getNextCanvasPhase('videos')).toBeNull()
  })

  it('decides not to advance non-canvas or incomplete tasks', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'generate',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toMatchObject({
      shouldAdvance: false,
      reason: 'not_canvas_task',
    })
  })

  it('decides not to advance when auto progress is disabled', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, false)).toEqual({
      shouldAdvance: false,
      currentPhase: 'analyze',
      nextPhase: 'characters',
      reason: 'auto_progress_disabled',
    })
  })

  it('pauses before user confirmation phases', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.locationRefs',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toEqual({
      shouldAdvance: false,
      currentPhase: 'locationRefs',
      nextPhase: 'storyboard',
      reason: 'pause_before',
    })
  })

  it('allows ordinary automatic phase advancement', () => {
    expect(decideCanvasAutoAdvance({
      type: 'canvas.analyze',
      domain: 'canvas',
      projectId: 'project-1',
      accountId: 'account-1',
    }, true)).toEqual({
      shouldAdvance: true,
      currentPhase: 'analyze',
      nextPhase: 'characters',
    })
  })
})
