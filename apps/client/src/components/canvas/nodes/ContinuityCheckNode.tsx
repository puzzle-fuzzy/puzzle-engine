import type { ContinuityIssue, ProjectDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import type { RunningPhaseInfo } from '../PipelineController'
import { Handle, Position } from '@xyflow/react'
import { RunningBadge, runningBorder, RunningOverlay } from '../RunningOverlay'

export default function ContinuityCheckNode({ data }: NodeProps) {
  const { project, isRunning, runningPhaseInfo } = data as { project: ProjectDTO, isRunning?: boolean, runningPhaseInfo?: RunningPhaseInfo | null }
  const issues = project.continuityIssues

  const errors = issues.filter(i => i.severity === 'error')
  const warnings = issues.filter(i => i.severity === 'warning')

  return (
    <div className={`rounded-lg border-2 bg-rose-50 shadow-md w-85 relative ${runningBorder(isRunning, 'border-rose-400')}`}>
      <Handle type="target" position={Position.Top} className="bg-rose-400!" />
      <div className="bg-rose-400 text-white px-3 py-2 font-semibold text-sm flex items-center justify-between">
        <span>连续性检查</span>
        {isRunning && <RunningBadge label={runningPhaseInfo?.label} />}
      </div>
      {isRunning && <RunningOverlay runningPhaseInfo={runningPhaseInfo} />}
      <div className="p-3 space-y-2 text-sm">
        {/* 统计 */}
        <div className="flex gap-2 text-xs">
          <span className="bg-red-100 text-red-700 rounded-full px-2 py-0.5">
            {errors.length}
            {' '}
            错误
          </span>
          <span className="bg-yellow-100 text-yellow-700 rounded-full px-2 py-0.5">
            {warnings.length}
            {' '}
            警告
          </span>
        </div>

        {/* 问题列表 */}
        {issues.length === 0
          ? (
              <p className="text-xs text-green-600">无连续性问题</p>
            )
          : (
              <div className="space-y-2 max-h-75 overflow-auto">
                {issues.map((issue: ContinuityIssue) => (
                  <div
                    key={`${issue.severity}-${issue.message}`}
                    className={`rounded border p-2 text-xs ${
                      issue.severity === 'error'
                        ? 'border-red-300 bg-red-50'
                        : 'border-yellow-300 bg-yellow-50'
                    }`}
                  >
                    <div className="flex items-center gap-2 font-medium">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] ${
                        issue.severity === 'error' ? 'bg-red-200 text-red-800' : 'bg-yellow-200 text-yellow-800'
                      }`}
                      >
                        {issue.code}
                      </span>
                      {issue.shotIndex !== undefined && (
                        <span className="text-muted-foreground">
                          镜头
                          {issue.shotIndex}
                        </span>
                      )}
                    </div>
                    <p className="mt-1">{issue.message}</p>
                    {issue.suggestion && (
                      <p className="mt-0.5 text-muted-foreground italic">
                        建议：
                        {issue.suggestion}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}

        {/* Dev mode */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">完整 JSON</summary>
          <pre className="text-[10px] bg-white rounded p-2 mt-1 max-h-75 overflow-auto whitespace-pre-wrap">
            {JSON.stringify(issues, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="bg-rose-400!" />
    </div>
  )
}
