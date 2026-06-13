import type { ProjectDTO } from '@excuse/shared'
import type { RunningPhaseInfo } from '../components/canvas/PipelineController'
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router'
import { getCanvasProject } from '../api/client'
import CanvasFlow from '../components/canvas/CanvasFlow'
import NodeDetailPanel from '../components/canvas/NodeDetailPanel'
import PipelineController from '../components/canvas/PipelineController'
import { useRealtimeSync } from '../stores/realtime-sync'

export default function CanvasEditor() {
  const { projectId } = useParams<{ projectId: string }>()
  const [project, setProject] = useState<ProjectDTO | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<{ id: string, type: string } | null>(null)
  const [runningPhase, setRunningPhase] = useState<RunningPhaseInfo | null>(null)

  // 从 RealtimeSync 获取项目版本号和 pipeline 阶段完成信号
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)
  const phaseDone = useRealtimeSync(s => s.phaseDone)
  const consumePhaseDone = useRealtimeSync(s => s.consumePhaseDone)

  const loadProject = useCallback(async () => {
    if (!projectId)
      return
    try {
      const res = await getCanvasProject(projectId)
      setProject(res.data)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    }
    finally {
      setLoading(false)
    }
  }, [projectId])

  useEffect(() => {
    loadProject()
  }, [loadProject])

  // 项目版本号变化时重新加载（由 pipeline_node_update SSE 事件驱动）
  useEffect(() => {
    if (projectVersion && projectVersion > 0) {
      loadProject()
      const timer = window.setTimeout(loadProject, 800)
      return () => clearTimeout(timer)
    }
  }, [projectVersion, loadProject])

  if (loading) {
    return <div className="flex items-center justify-center h-screen text-muted-foreground">加载项目...</div>
  }

  if (error || !project) {
    return (
      <div className="flex items-center justify-center h-screen text-red-600">
        {error || '项目不存在'}
      </div>
    )
  }

  return (
    <div className="flex flex-col h-[calc(100vh-56px)]">
      {/* Top toolbar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b bg-background/80 backdrop-blur-sm">
        <h1 className="font-semibold text-sm truncate">
          {project.title || '未命名项目'}
        </h1>
        <span className="text-xs px-2 py-0.5 rounded-full bg-muted">
          {project.status}
        </span>
        {runningPhase && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 animate-pulse">
            正在
            {runningPhase.label}
            {runningPhase.modelName && ` · ${runningPhase.modelName}`}
          </span>
        )}
      </div>

      {/* Canvas area */}
      <div className="flex-1 relative">
        <CanvasFlow
          project={project}
          runningPhase={runningPhase}
          onNodeClick={(nodeId, nodeType) => {
            setSelectedNode(selectedNode?.id === nodeId ? null : { id: nodeId, type: nodeType })
          }}
        />

        {/* Side panel for selected node */}
        {selectedNode && (
          <div className="absolute right-4 top-4 bottom-4 w-90 bg-background border rounded-lg shadow-lg overflow-auto">
            <div className="sticky top-0 bg-background border-b px-4 py-2 flex items-center justify-between">
              <span className="text-sm font-medium">
                节点详情
              </span>
              <button
                onClick={() => setSelectedNode(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                关闭
              </button>
            </div>
            <NodeDetailPanel
              selectedNode={selectedNode}
              project={project}
              onUpdate={loadProject}
            />
          </div>
        )}
      </div>

      {/* Pipeline controller bar */}
      <PipelineController
        projectId={project.id}
        project={project}
        modelPreferences={project.modelPreferences}
        onPhaseComplete={loadProject}
        onPhaseChange={setRunningPhase}
        phaseDone={phaseDone}
        onPhaseDoneConsumed={consumePhaseDone}
      />
    </div>
  )
}
