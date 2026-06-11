import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useState } from 'react'
import { updateCanvasCharacter, updateCanvasLocation, updateCanvasProject, updateCanvasShot, uploadFile } from '../../api/client'
import { Button } from '../ui/button'
import { Input } from '../ui/input'
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

  const isProjectNode = selectedNode.type === 'storyInput' || selectedNode.type === 'analysis'
  const [editTitle, setEditTitle] = useState(project.title ?? '')
  const [editStoryText, setEditStoryText] = useState(project.storyText)
  const [editSaving, setEditSaving] = useState(false)

  const handleProjectUpdate = useCallback(async () => {
    // Only send fields that actually changed
    const patch: { title?: string, storyText?: string } = {}
    const titleChanged = editTitle !== (project.title ?? '')
    const storyTextChanged = editStoryText !== project.storyText
    if (titleChanged)
      patch.title = editTitle
    if (storyTextChanged)
      patch.storyText = editStoryText
    if (!titleChanged && !storyTextChanged)
      return

    setEditSaving(true)
    try {
      await updateCanvasProject(project.id, patch)
      onUpdate()
    }
    catch (err) {
      console.error('Failed to update project:', err)
    }
    finally {
      setEditSaving(false)
    }
  }, [project, editTitle, editStoryText, onUpdate])

  const hasChanges = editTitle !== (project.title ?? '') || editStoryText !== project.storyText
  const storyTextInvalid = editStoryText !== project.storyText && editStoryText.length < 10

  const nodeTitle = shot
    ? `镜头 ${shot.shotIndex}`
    : character
      ? `角色: ${character.name}`
      : location
        ? `场景: ${location.name}`
        : isProjectNode
          ? '项目信息'
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

      {!shot && !character && !location && isProjectNode && (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">项目标题</label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="输入项目标题"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              故事文本
              <span className="ml-1 text-muted-foreground/60">
                ({editStoryText.length} 字符)
              </span>
            </label>
            <textarea
              value={editStoryText}
              onChange={(e) => setEditStoryText(e.target.value)}
              className="flex min-h-30 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="在此粘贴故事文本..."
              rows={6}
            />
          </div>
          <Button
            size="sm"
            onClick={handleProjectUpdate}
            disabled={editSaving || !hasChanges || storyTextInvalid}
          >
            {editSaving ? '保存中...' : '保存修改'}
          </Button>
        </div>
      )}

      {!shot && !character && !location && !isProjectNode && (
        <p className="text-xs text-muted-foreground">
          选中故事输入、分析、角色、场景或镜头节点可查看和编辑详细信息。
        </p>
      )}
    </div>
  )
}
