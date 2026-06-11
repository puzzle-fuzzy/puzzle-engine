import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { updateCanvasCharacter, updateCanvasLocation, updateCanvasShot, uploadFile } from '../../api/client'
import { PromptEditor } from './PromptEditor'
import { ReferenceUploadZone } from './ReferenceUploadZone'

interface NodeDetailPanelProps {
  selectedNode: { id: string, type: string }
  project: ProjectDTO
  onUpdate: () => void
}

export default function NodeDetailPanel({ selectedNode, project, onUpdate }: NodeDetailPanelProps) {
  const [saving, setSaving] = useState(false)

  // Node IDs in ReactFlow use prefixes: char-xxx, loc-xxx, shot-xxx
  const entityId = selectedNode.id.replace(/^(char-|loc-|shot-)/, '')
  const shot = project.shots.find(s => s.id === entityId)
  const character = project.characters.find(c => c.id === entityId)
  const location = project.locations.find(l => l.id === entityId)

  const handleShotPromptUpdate = useCallback(async (prompt: string) => {
    if (!shot)
      return
    setSaving(true)
    try {
      await updateCanvasShot(shot.id, { videoPrompt: prompt })
      onUpdate()
    }
    catch (err) {
      console.error('Failed to update shot prompt:', err)
    }
    finally {
      setSaving(false)
    }
  }, [shot, onUpdate])

  const handleCharacterUpload = useCallback(async (file: File) => {
    if (!character)
      return ''
    const res = await uploadFile(file)
    await updateCanvasCharacter(character.id, { referenceImageUrl: res.file.publicUrl })
    onUpdate()
    return res.file.publicUrl
  }, [character, onUpdate])

  const handleLocationUpload = useCallback(async (file: File) => {
    if (!location)
      return ''
    const res = await uploadFile(file)
    await updateCanvasLocation(location.id, { referenceImageUrl: res.file.publicUrl })
    onUpdate()
    return res.file.publicUrl
  }, [location, onUpdate])

  const nodeTitle = shot
    ? `镜头 ${shot.shotIndex}`
    : character
      ? `角色: ${character.name}`
      : location
        ? `场景: ${location.name}`
        : selectedNode.type

  return (
    <div className="p-4 space-y-4 text-sm">
      <h3 className="font-semibold text-base">{nodeTitle}</h3>

      {shot && (
        <>
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">
              视频 Prompt
              {saving && <span className="ml-2 text-yellow-600">保存中...</span>}
            </label>
            <PromptEditor
              value={shot.videoPrompt || ''}
              onChange={handleShotPromptUpdate}
              characters={project.characters}
              locations={project.locations}
              placeholder="输入视频提示词，@ 插入角色/场景引用..."
              rows={6}
            />
          </div>

          {shot.negativePrompt && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Negative Prompt</label>
              <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
                {shot.negativePrompt}
              </p>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">叙事描述</label>
            <p className="text-xs">{shot.narrative}</p>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <span className="text-muted-foreground">时长:</span>
              {' '}
              {shot.duration}
              s
            </div>
            <div>
              <span className="text-muted-foreground">状态:</span>
              {' '}
              {shot.status}
            </div>
          </div>

          {shot.videoUrl && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">视频预览</label>
              <video
                src={shot.videoUrl}
                controls
                className="w-full rounded-lg"
              />
            </div>
          )}
        </>
      )}

      {character && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">身份 Prompt</label>
            <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
              {character.identityPrompt || '未生成'}
            </p>
          </div>

          <ReferenceUploadZone
            currentUrl={character.referenceImageUrl}
            onUpload={handleCharacterUpload}
            label="角色参考图"
          />

          <div className="text-xs">
            <span className="text-muted-foreground">角色定位:</span>
            {' '}
            {character.role}
          </div>
        </>
      )}

      {location && (
        <>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">场景 Prompt</label>
            <p className="text-xs bg-muted/50 rounded p-2 font-mono whitespace-pre-wrap">
              {location.scenePrompt || '未生成'}
            </p>
          </div>

          <ReferenceUploadZone
            currentUrl={location.referenceImageUrl}
            onUpload={handleLocationUpload}
            label="场景参考图"
          />

          <div className="text-xs">
            <span className="text-muted-foreground">类型:</span>
            {' '}
            {location.type}
          </div>
        </>
      )}

      {!shot && !character && !location && (
        <p className="text-xs text-muted-foreground">
          选中角色、场景或镜头节点可查看和编辑详细信息。
        </p>
      )}
    </div>
  )
}
