import type { LocationDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

export default function LocationNode({ data }: NodeProps) {
  const { location, isRunning } = data as { location: LocationDTO, isRunning?: boolean }
  const profile = location.profile

  return (
    <div className={`rounded-lg border-2 bg-amber-50 shadow-md w-85 relative ${isRunning ? 'border-yellow-400 ring-2 ring-yellow-200' : 'border-amber-400'}`}>
      <Handle type="target" position={Position.Top} className="bg-amber-400!" />
      <div className="bg-amber-400 text-white px-3 py-2 font-semibold text-sm flex items-center justify-between rounded-t-md">
        <span>
          场景：
          {location.name}
        </span>
        <div className="flex items-center gap-1">
          {location.locked && <span className="text-[10px] bg-white/20 rounded px-1">锁定</span>}
          <span className="text-[10px] bg-white/20 rounded px-1">{location.type}</span>
          {isRunning && <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-1.5 animate-pulse">生成中</span>}
        </div>
      </div>
      {isRunning && (
        <div className="absolute inset-0 bg-white/30 flex items-center justify-center rounded-lg pointer-events-none">
          <div className="bg-yellow-100 text-yellow-700 text-xs font-medium px-3 py-1.5 rounded-full shadow animate-pulse">
            正在生成...
          </div>
        </div>
      )}
      <div className="p-3 space-y-2 text-sm">
        {/* 参考图 */}
        {location.referenceImageUrl && (
          <div>
            <img
              src={location.referenceImageUrl}
              alt={location.name}
              className="w-full h-[140px] object-cover rounded border"
            />
          </div>
        )}

        {profile && (
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">位置：</span>
              {profile.location}
              ，
              {profile.era}
            </div>
            <div>
              <span className="text-muted-foreground">氛围：</span>
              {profile.atmosphere}
            </div>
            <div>
              <span className="text-muted-foreground">色板：</span>
              {profile.visualRules.colorPalette.join('、')}
            </div>
            <div>
              <span className="text-muted-foreground">灯光：</span>
              {profile.visualRules.lighting}
            </div>
            <div>
              <span className="text-muted-foreground">建筑：</span>
              {profile.visualRules.architecture}
            </div>
            <div>
              <span className="text-muted-foreground">地面：</span>
              {profile.visualRules.floor}
            </div>
            {profile.visualRules.backgroundElements.length > 0 && (
              <div>
                <span className="text-muted-foreground">背景元素：</span>
                {profile.visualRules.backgroundElements.join('、')}
              </div>
            )}
            <div className="border-t pt-1 mt-1">
              <span className="text-muted-foreground">摄像规则：</span>
              <div className="mt-0.5">
                轴线：
                {profile.cameraRules.axisDirection}
              </div>
              <div>
                允许：
                {profile.cameraRules.allowedAngles.join('、')}
              </div>
              {profile.cameraRules.forbiddenAngles.length > 0 && (
                <div className="text-red-600">
                  禁止：
                  {profile.cameraRules.forbiddenAngles.join('、')}
                </div>
              )}
            </div>
          </div>
        )}

        {/* scenePrompt */}
        {location.scenePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Scene Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[80px] overflow-auto">
              {location.scenePrompt}
            </p>
          </div>
        )}

        {/* negativePrompt */}
        {location.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Negative Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[60px] overflow-auto text-red-600">
              {location.negativePrompt}
            </p>
          </div>
        )}

        {/* Dev mode */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">完整 Profile JSON</summary>
          <pre className="text-[10px] bg-white rounded p-2 mt-1 max-h-[300px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(profile, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-amber-400" />
    </div>
  )
}
