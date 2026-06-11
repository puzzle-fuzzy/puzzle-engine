import type { ProjectDTO, ShotDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

const SHOT_STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-200 text-gray-700',
  ready: 'bg-blue-100 text-blue-700',
  generating: 'bg-yellow-100 text-yellow-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
}

const SHOT_STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  ready: '就绪',
  generating: '生成中',
  completed: '已完成',
  failed: '失败',
}

export default function ShotNode({ data }: NodeProps) {
  const { shot, project, isRunning } = data as { shot: ShotDTO, project: ProjectDTO, isRunning?: boolean }

  const camera = shot.camera as Record<string, string>
  const continuity = shot.continuity as Record<string, unknown>
  const environment = shot.environment as Record<string, string> | null

  // Find related character/location names
  const charNames = shot.characterIds
    .map(id => project.characters.find(c => c.id === id)?.name)
    .filter(Boolean)
  const locName = shot.locationId
    ? project.locations.find(l => l.id === shot.locationId)?.name
    : null

  return (
    <div className={`rounded-lg border-2 bg-cyan-50 shadow-md w-[340px] relative ${isRunning ? 'border-yellow-400 ring-2 ring-yellow-200' : 'border-cyan-400'}`}>
      <Handle type="target" position={Position.Top} className="!bg-cyan-400" />
      <div className="bg-cyan-400 text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-md">
        <span>
          镜头
          {shot.shotIndex + 1}
        </span>
        {isRunning ? (
          <span className="text-[10px] rounded-full px-2 py-0.5 bg-yellow-100 text-yellow-700 animate-pulse">
            生成中...
          </span>
        ) : (
          <span className={`text-[10px] rounded-full px-2 py-0.5 ${SHOT_STATUS_COLORS[shot.status] || ''}`}>
            {SHOT_STATUS_LABELS[shot.status] || shot.status}
          </span>
        )}
      </div>
      {isRunning && (
        <div className="absolute inset-0 bg-white/30 flex items-center justify-center rounded-lg pointer-events-none">
          <div className="bg-yellow-100 text-yellow-700 text-xs font-medium px-3 py-1.5 rounded-full shadow animate-pulse">
            正在生成...
          </div>
        </div>
      )}
      <div className="p-3 space-y-2 text-sm">
        {/* 基本信息 */}
        <div className="text-xs space-y-1">
          <div>
            <span className="text-muted-foreground">时长：</span>
            {shot.duration}
            s
          </div>
          {locName && (
            <div>
              <span className="text-muted-foreground">场景：</span>
              {locName}
            </div>
          )}
          {charNames.length > 0 && (
            <div>
              <span className="text-muted-foreground">角色：</span>
              {charNames.join('、')}
            </div>
          )}
        </div>

        {/* 叙事 */}
        <div>
          <span className="text-muted-foreground text-xs">叙事：</span>
          <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[60px] overflow-auto">
            {shot.narrative}
          </p>
        </div>

        {/* 摄像 */}
        <div className="text-xs">
          <span className="text-muted-foreground">摄像：</span>
          {camera.shotSize}
          ，
          {camera.angle}
          ，
          {camera.movement}
          ，
          {camera.lens}
        </div>

        {/* 时间线 */}
        {shot.timeline && shot.timeline.length > 0 && (
          <div>
            <span className="text-muted-foreground text-xs">逐秒时间线：</span>
            <div className="text-xs bg-white rounded p-2 mt-0.5 max-h-[100px] overflow-auto space-y-0.5">
              {shot.timeline.map((entry, i) => (
                <div key={i}>
                  <span className="font-mono text-muted-foreground">
                    {entry.time}
                    :
                  </span>
                  {' '}
                  {entry.action}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 连续性 */}
        {continuity && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground">连续性：</span>
            {continuity.emotionStart && (
              <div>
                情绪：
                {String(continuity.emotionStart)}
                {' '}
                →
                {' '}
                {String(continuity.emotionEnd)}
              </div>
            )}
            {continuity.actionStart && (
              <div>
                动作：
                {String(continuity.actionStart)}
                {' '}
                →
                {' '}
                {String(continuity.actionEnd)}
              </div>
            )}
          </div>
        )}

        {/* 环境 */}
        {environment && (
          <div className="text-xs space-y-0.5">
            <span className="text-muted-foreground">环境：</span>
            {environment.lighting && (
              <div>
                灯光：
                {environment.lighting}
              </div>
            )}
            {environment.mood && (
              <div>
                情绪：
                {environment.mood}
              </div>
            )}
            {environment.backgroundMotion && (
              <div>
                背景运动：
                {environment.backgroundMotion}
              </div>
            )}
          </div>
        )}

        {/* 视频 Prompt */}
        {shot.videoPrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Video Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[80px] overflow-auto">
              {shot.videoPrompt}
            </p>
          </div>
        )}

        {/* 负面 Prompt */}
        {shot.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Negative Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[60px] overflow-auto text-red-600">
              {shot.negativePrompt}
            </p>
          </div>
        )}

        {/* 视频 */}
        {shot.videoUrl && (
          <div>
            <span className="text-muted-foreground text-xs">生成视频：</span>
            <video
              src={shot.videoUrl}
              controls
              className="w-full rounded border mt-0.5"
            />
          </div>
        )}

        {/* 错误 */}
        {shot.errorMessage && (
          <div className="text-xs text-red-600 bg-red-50 rounded p-2">
            {shot.errorMessage}
          </div>
        )}

        {/* Dev mode: raw JSON */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">原始 JSON 数据</summary>
          <pre className="text-[10px] bg-white rounded p-2 mt-1 max-h-[300px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(shot, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-400" />
    </div>
  )
}
