import type { CanvasModelPreferences, CanvasProjectStatus, ModelConfig, ProjectDTO } from '@excuse/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  analyzeCanvasProject,
  checkCanvasContinuity,
  fetchModels,
  generateCanvasCharacterRefs,
  generateCanvasCharacters,
  generateCanvasLocationRefs,
  generateCanvasLocations,
  generateCanvasStoryboard,
  generateCanvasVideos,
  rebuildCanvasPrompts,
  updateCanvasModelPreferences,
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
    failed: 0,
  }
  return map[status] ?? 0
}

interface PhaseDoneEvent {
  key: string
  status: 'completed' | 'failed'
  error?: string
}

interface Props {
  projectId: string
  projectStatus: CanvasProjectStatus
  modelPreferences: CanvasModelPreferences | null
  onPhaseComplete: (project?: ProjectDTO) => void
  onPhaseChange?: (phaseKey: string | null) => void
  phaseDone: PhaseDoneEvent | null
  onPhaseDoneConsumed: () => void
}

export default function PipelineController({
  projectId,
  projectStatus,
  modelPreferences,
  onPhaseComplete,
  onPhaseChange,
  phaseDone,
  onPhaseDoneConsumed,
}: Props) {
  const [autoMode, setAutoMode] = useState(false)
  const [running, setRunning] = useState(false)
  const [currentPhase, setCurrentPhase] = useState(-1)
  const [countdown, setCountdown] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [models, setModels] = useState<ModelConfig[]>([])
  const [prefs, setPrefs] = useState<CanvasModelPreferences>(modelPreferences ?? {})
  const autoRef = useRef(autoMode)
  autoRef.current = autoMode

  // Sync prefs from parent when project reloads
  useEffect(() => {
    setPrefs(modelPreferences ?? {})
  }, [modelPreferences])

  // Load models once
  useEffect(() => {
    fetchModels()
      .then(res => setModels(res.models))
      .catch(() => { toast.error('加载模型列表失败') })
  }, [])

  const textModels = useMemo(() => models.filter(m => m.category === 'text'), [models])
  const imageModels = useMemo(() => models.filter(m => m.category === 'image'), [models])

  async function handleModelChange(key: keyof CanvasModelPreferences, value: string) {
    const next = { ...prefs, [key]: value }
    setPrefs(next)
    try {
      const res = await updateCanvasModelPreferences(projectId, next)
      onPhaseComplete(res.data)
    }
    catch {
      setPrefs(prefs)
      toast.error('保存模型偏好失败')
    }
  }

  const startIdx = getPhaseIndex(projectStatus)

  // Fire a phase API call (returns immediately in fire-and-forget mode)
  const triggerPhase = useCallback(async (idx: number) => {
    const phase = PHASES[idx]
    if (!phase)
      return

    setCurrentPhase(idx)
    setRunning(true)
    setError(null)
    onPhaseChange?.(phase.key)

    try {
      await phase.run(projectId)
      // API acknowledged (fire-and-forget: returns immediately)
      // Actual completion is tracked via phaseDone SSE events
    }
    catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(`${phase.label} 触发失败: ${msg}`)
      setRunning(false)
      setCurrentPhase(-1)
      onPhaseChange?.(null)
    }
  }, [projectId, onPhaseChange])

  // Advance to next phase after current phase completes
  const advanceAfterPhase = useCallback((completedIdx: number) => {
    const nextIdx = completedIdx + 1
    if (nextIdx >= PHASES.length) {
      setRunning(false)
      setCurrentPhase(-1)
      onPhaseChange?.(null)
      return
    }

    const nextPhase = PHASES[nextIdx]
    if (nextPhase.pauseBefore) {
      setRunning(false)
      setCurrentPhase(-1)
      onPhaseChange?.(null)
      if (autoRef.current) {
        setCountdown(3)
      }
    }
    else if (autoRef.current) {
      triggerPhase(nextIdx)
    }
    else {
      setRunning(false)
      setCurrentPhase(-1)
      onPhaseChange?.(null)
    }
  }, [onPhaseChange, triggerPhase])

  // Handle phase completion from SSE events
  useEffect(() => {
    if (!phaseDone || !running || currentPhase < 0)
      return

    const phase = PHASES[currentPhase]
    if (!phase || phase.key !== phaseDone.key)
      return

    onPhaseDoneConsumed()

    // Reload project data before advancing
    onPhaseComplete()

    if (phaseDone.status === 'failed') {
      setError(`${phase.label} 失败: ${phaseDone.error || '未知错误'}`)
      setRunning(false)
      setCurrentPhase(-1)
      onPhaseChange?.(null)
      return
    }

    // Phase completed successfully, advance
    advanceAfterPhase(currentPhase)
  }, [phaseDone, running, currentPhase, onPhaseDoneConsumed, onPhaseComplete, advanceAfterPhase, onPhaseChange])

  // Countdown timer for auto mode pauses
  useEffect(() => {
    if (countdown <= 0)
      return
    const timer = setTimeout(() => {
      const next = countdown - 1
      setCountdown(next)
      if (next === 0) {
        const resumeIdx = getPhaseIndex(projectStatus)
        triggerPhase(resumeIdx)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [countdown, projectStatus, triggerPhase])

  function handleRunFrom(idx: number) {
    if (running)
      return
    setAutoMode(false)
    setError(null)
    triggerPhase(idx)
  }

  function handleAutoRun() {
    if (running)
      return
    setAutoMode(true)
    setError(null)
    triggerPhase(startIdx)
  }

  function handleSkipAndContinue() {
    if (running)
      return
    const nextIdx = startIdx + 1
    if (nextIdx < PHASES.length) {
      setAutoMode(false)
      setError(null)
      triggerPhase(nextIdx)
    }
  }

  function handleCancelCountdown() {
    setCountdown(0)
    setAutoMode(false)
  }

  const currentPhaseLabel = currentPhase >= 0 ? PHASES[currentPhase].label : null

  return (
    <div className="border-t bg-background/95 backdrop-blur-sm px-4 py-3">
      {/* Model selectors */}
      <div className="flex items-center gap-3 mb-2 text-xs">
        <ModelSelect
          label="文本模型"
          models={textModels}
          value={prefs.textModel || ''}
          onChange={v => handleModelChange('textModel', v)}
          disabled={running}
        />
        <ModelSelect
          label="图像模型"
          models={imageModels}
          value={prefs.imageModel || ''}
          onChange={v => handleModelChange('imageModel', v)}
          disabled={running}
        />
      </div>

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

          {running && currentPhaseLabel && (
            <span className="text-xs text-blue-600 font-medium animate-pulse">
              正在
              {currentPhaseLabel}
              ...
            </span>
          )}
          {running && !currentPhaseLabel && (
            <span className="text-xs text-muted-foreground">
              执行中...
            </span>
          )}

          {error && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-red-600 max-w-[200px] truncate" title={error}>
                {error}
              </span>
              <button
                onClick={() => handleRunFrom(startIdx)}
                className="text-xs px-2 py-1 rounded border border-orange-300 text-orange-700 hover:bg-orange-50"
              >
                重试
              </button>
              {startIdx + 1 < PHASES.length && (
                <button
                  onClick={handleSkipAndContinue}
                  className="text-xs px-2 py-1 rounded border border-blue-300 text-blue-700 hover:bg-blue-50"
                >
                  跳过继续
                </button>
              )}
            </div>
          )}

          {!running && countdown === 0 && !error && (
            <button
              onClick={handleAutoRun}
              className="text-xs px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 font-medium"
            >
              自动执行全部
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ModelSelect({ label, models, value, onChange, disabled }: {
  label: string
  models: ModelConfig[]
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-muted-foreground">
      <span>{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="text-xs px-1.5 py-0.5 rounded border border-border bg-background text-foreground max-w-[180px]"
      >
        <option value="">默认</option>
        {models.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </label>
  )
}
