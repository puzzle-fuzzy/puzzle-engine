import type { CharacterDTO, ProjectDTO } from '@excuse/shared'
import type { NodeProps } from '@xyflow/react'
import { Handle, Position } from '@xyflow/react'

export default function CharacterNode({ data }: NodeProps) {
  const { character, project } = data as { character: CharacterDTO, project: ProjectDTO }
  const profile = character.profile

  return (
    <div className="rounded-lg border-2 border-violet-400 bg-violet-50 shadow-md w-[340px]">
      <Handle type="target" position={Position.Top} className="!bg-violet-400" />
      <div className="bg-violet-400 text-white px-3 py-2 font-semibold text-sm flex items-center justify-between">
        <span>
          角色：
          {character.name}
        </span>
        <div className="flex items-center gap-1">
          {character.locked && <span className="text-[10px] bg-white/20 rounded px-1">锁定</span>}
          {character.role && <span className="text-[10px] bg-white/20 rounded px-1">{character.role}</span>}
        </div>
      </div>
      <div className="p-3 space-y-2 text-sm">
        {/* 参考图 */}
        {character.referenceImageUrl && (
          <div>
            <img
              src={character.referenceImageUrl}
              alt={character.name}
              className="w-full h-[140px] object-cover rounded border"
            />
          </div>
        )}
        {character.turnaroundSheetUrl && (
          <div>
            <span className="text-muted-foreground text-xs">转面图：</span>
            <img
              src={character.turnaroundSheetUrl}
              alt="转面图"
              className="w-full h-[100px] object-cover rounded border mt-0.5"
            />
          </div>
        )}

        {/* Profile 摘要 */}
        {profile && (
          <div className="space-y-1 text-xs">
            <div>
              <span className="text-muted-foreground">外貌：</span>
              {profile.gender}
              ，
              {profile.age}
              ，
              {profile.bodyShape}
              ，
              {profile.height}
            </div>
            <div>
              <span className="text-muted-foreground">面部：</span>
              {profile.face.shape}
              脸，
              {profile.face.eyes}
              ，
              {profile.face.skin}
            </div>
            <div>
              <span className="text-muted-foreground">发型：</span>
              {profile.hair.color}
              {profile.hair.style}
              （
              {profile.hair.length}
              ）
            </div>
            <div>
              <span className="text-muted-foreground">服装：</span>
              {profile.costume.mainColor}
              {profile.costume.style}
              （
              {profile.costume.material}
              ）
            </div>
            {profile.accessories.length > 0 && (
              <div>
                <span className="text-muted-foreground">配饰：</span>
                {profile.accessories.join('、')}
              </div>
            )}
          </div>
        )}

        {/* identityPrompt */}
        {character.identityPrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Identity Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[80px] overflow-auto">
              {character.identityPrompt}
            </p>
          </div>
        )}

        {/* negativePrompt */}
        {character.negativePrompt && (
          <div>
            <span className="text-muted-foreground text-xs">Negative Prompt：</span>
            <p className="text-xs bg-white rounded p-2 mt-0.5 max-h-[60px] overflow-auto text-red-600">
              {character.negativePrompt}
            </p>
          </div>
        )}

        {/* Dev mode: full profileJson */}
        <details className="mt-2">
          <summary className="text-xs text-muted-foreground cursor-pointer">完整 Profile JSON</summary>
          <pre className="text-[10px] bg-white rounded p-2 mt-1 max-h-[300px] overflow-auto whitespace-pre-wrap">
            {JSON.stringify(profile, null, 2)}
          </pre>
        </details>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-violet-400" />
    </div>
  )
}
