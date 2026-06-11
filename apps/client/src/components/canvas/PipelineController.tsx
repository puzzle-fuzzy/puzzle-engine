import type { CanvasProjectStatus } from '@excuse/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  analyzeCanvasProject,
  checkCanvasContinuity,
  generateCanvasCharacterRefs,
  generateCanvasCharacters,
  generateCanvasLocationRefs,
  generateCanvasLocations,
  generateCanvasStoryboard,
  generateCanvasVideos,
  rebuildCanvasPrompts,
} from '../../api/client'

interface PipelinePhase {
  key: string
  label: string
  status: CanvasProjectStatus | null
  run: (projectId: string) => Promise<unknown>
  pauseBefore?: boolean
}

const PHASES: PipelinePhase[] = [
  { key: 'analyze', label: '分析故事', status: 'analyzed', run: id => analyzeCanvasProject(id) },
  { key: 'characters', label: '生成角色', status: 'characters_ready', run: id => generateCanvasCharacters(id) },
  { key: 'locations', label: '生成场景', status: 'locations_ready', run: id => generateCanvasLocations(id) },
  { key: 'characterRefs', label: '角色参考图', status: 'refs_ready', run: id => generateCanvasCharacterRefs(id) },
  { key: 'locationRefs', label: '场景参考图', status: null, run: id => generateCanvasLocationRefs(id) },
  { key: 'storyboard', label: '生成分镜', status: 'storyboard_ready', run: id => generateCanvasStoryboard(id), pauseBefore: true },
  { key: 'continuity', label: '连续性检查', status: 'continuity_checked', run: id => checkCanvasContinuity(id) },
  { key: 'rebuild', label: '重建 Prompt', status: 'prompts_ready', run: id => rebuildCanvasPrompts(id) },
  { key: 'videos', label: '生成视频', status: 'generating', run: id => generateCanvasVideos(id), pauseBefore: true },
]

// Map project status → phase index that was just completed
function getPhaseIndex(status: CanvasProjectStatus): number {
  const map: Record<string, number> = {
    draft: 0,
    analyzed: 1,
    characters_ready: 2,
    locations_ready: 3,
    refs_ready: 5,
    storyboard_ready: 6,
    continuity_checked: 7,
    prompts_ready: 8,
    generating: 9,
    completed: 9,
    failed: -1,
  }
  return map[status] ?? 0
}

interface Props {
  projectId: string
  projectStatus: CanvasProjectStatus
  onPhaseComplete: () => void
}

export default function PipelineController({ projectId, projectStatus, onPhaseComplete }: Props) {
  const [autoMode, setAutoMode] = useState(false)
  const [running, setRunning] = useState(false)
  const [currentPhase, setCurrentPhase] = useState(-1)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const autoRef = useRef(autoMode)
  autoRef.current = autoMode

  const startIdx = getPhaseIndex(projectStatus)

  const runPhase = useCallback(async (idx: number) => {
    const phase = PHASES[idx]
    if (!phase)
      return

    setCurrentPhase(idx)
    setRunning(true)
    setError(null)

    try {
      await phase.run(projectId)
      onPhaseComplete()
    }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${phase.label} 失败: ${msg}`)
      setRunning(false)
      setCurrentPhase(-1)
      return
    }

    // Move to next phase
    const nextIdx = idx + 1
    if (nextIdx >= PHASES.length) {
      setRunning(false)
      setCurrentPhase(-1)
      return
    }

    const nextPhase = PHASES[nextIdx]
    if (nextPhase.pauseBefore) {
      setRunning(false)
      setCurrentPhase(-1)
      if (autoRef.current) {
        // 3 second countdown
        setCountdown(3)
      }
    }
    else if (autoRef.current) {
      runPhase(nextIdx)
    }
    else {
      setRunning(false)
      setCurrentPhase(-1)
    }
  }, [projectId, onPhaseComplete])

  // Countdown timer for auto mode pauses
  useEffect(() => {
    if (countdown <= 0)
      return
    const timer = setTimeout(() => {
      const next = countdown - 1
      setCountdown(next)
      if (next === 0) {
        // Resume from next phase after pause
        const pauseIdx = PHASES.findIndex(p => p.pauseBefore)
        // Find the phase after the current progress
        const resumeIdx = getPhaseIndex(projectStatus)
        // The next runnable phase
        let targetIdx = resumeIdx
        for (let i = resumeIdx; i < PHASES.length; i++) {
          if (PHASES[i].pauseBefore && i > 0 && !PHASES[i - 1].pauseBefore) {
            // this is the first pause after where we are
          }
          targetIdx = i
          break
        }
        runPhase(targetIdx)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [countdown, projectStatus, runPhase])

  function handleRunFrom(idx: number) {
    if (running)
      return
    setAutoMode(false)
    runPhase(idx)
  }

  function handleAutoRun() {
    if (running)
      return
    setAutoMode(true)
    runPhase(startIdx)
  }

  function handleCancelCountdown() {
    setCountdown(0)
    setAutoMode(false)
  }

  return (
    <div className="border-t bg-background/95 backdrop-blur-sm px-4 py-3">
      {/* Phase progress bar */}
      <div className="flex items-center gap-1 mb-2">
        {PHASES.map((phase, idx) => {
          const isCompleted = idx < startIdx
          const isCurrent = idx === currentPhase
          const isPending = idx >= startIdx && !isCurrent

          return (
            <div
              key={phase.key}
              className={`
                flex-1 h-2 rounded-full transition-colors
                ${isCompleted ? 'bg-green-400' : ''}
                ${isCurrent ? 'bg-blue-400 animate-pulse' : ''}
                ${isPending ? 'bg-gray-200' : ''}
              `}
              title={phase.label}
            />
          )
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 flex-wrap flex-1">
          {PHASES.map((phase, idx) => {
            const isCompleted = idx < startIdx
            const isCurrent = idx === currentPhase
            const canRun = idx === startIdx || isCurrent

            return (
              <button
                key={phase.key}
                onClick={() => canRun && handleRunFrom(idx)}
                disabled={running || (!canRun && !isCompleted)}
                className={`
                  text-xs px-2 py-1 rounded border transition-colors
                  ${isCompleted ? 'bg-green-50 border-green-300 text-green-700' : ''}
                  ${isCurrent ? 'bg-blue-50 border-blue-300 text-blue-700 font-medium' : ''}
                  ${!isCompleted && !isCurrent ? 'bg-gray-50 border-gray-200 text-gray-400' : ''}
                  ${canRun && !running ? 'hover:bg-blue-100 cursor-pointer' : ''}
                `}
              >
                {phase.label}
                {phase.pauseBefore && ' ⏸'}
              </button>
            )
          })}
        </div>

        <div className="flex items-center gap-2">
          {countdown > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-yellow-600">
                即将执行下一步... (
                {countdown}
                s)
              </span>
              <button
                onClick={handleCancelCountdown}
                className="text-xs px-2 py-1 rounded border border-yellow-300 text-yellow-700 hover:bg-yellow-50"
              >
                暂停
              </button>
            </div>
          )}

          {error && (
            <span className="text-xs text-red-600 max-w-[200px] truncate" title={error}>
              {error}
            </span>
          )}

          {!running && countdown === 0 && (
            <button
              onClick={handleAutoRun}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              自动执行全部
            </button>
          )}

          {running && (
            <span className="text-xs text-muted-foreground">
              执行中...
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
