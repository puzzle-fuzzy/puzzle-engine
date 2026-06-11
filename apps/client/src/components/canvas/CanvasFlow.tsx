import type { ProjectDTO } from '@excuse/shared'
import type { Edge, Node, NodeTypes } from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from '@xyflow/react'
import { useCallback, useEffect, useRef } from 'react'
import AnalysisNode from './nodes/AnalysisNode'
import CharacterNode from './nodes/CharacterNode'
import ContinuityCheckNode from './nodes/ContinuityCheckNode'
import LocationNode from './nodes/LocationNode'
import ShotNode from './nodes/ShotNode'
import StoryInputNode from './nodes/StoryInputNode'
import '@xyflow/react/dist/style.css'

const NODE_WIDTH = 340
const NODE_SEP = 80
const RANK_SEP = 120

const nodeTypes: NodeTypes = {
  storyInput: StoryInputNode,
  analysis: AnalysisNode,
  character: CharacterNode,
  location: LocationNode,
  shot: ShotNode,
  continuityCheck: ContinuityCheckNode,
}

const PHASE_NODE_TYPE: Record<string, string> = {
  analyze: 'analysis',
  characters: 'character',
  locations: 'location',
  characterRefs: 'character',
  locationRefs: 'location',
  storyboard: 'shot',
  continuity: 'continuityCheck',
  rebuild: 'shot',
  videos: 'shot',
}

function computeLayout(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length === 0) return nodes

  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'TB', nodesep: NODE_SEP, ranksep: RANK_SEP })

  for (const node of nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: node.measured?.height ?? 200 })
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target)
  }

  dagre.layout(g)

  return nodes.map((node) => {
    const pos = g.node(node.id)
    if (!pos) return node
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - (node.measured?.height ?? 200) / 2 },
    }
  })
}

export function buildNodesAndEdges(project: ProjectDTO, runningPhase: string | null = null): { nodes: Node[], edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []
  const runningNodeType = runningPhase ? PHASE_NODE_TYPE[runningPhase] : null
  const isRunning = (type: string) => runningNodeType === type

  nodes.push({
    id: 'story',
    type: 'storyInput',
    position: { x: 0, y: 0 },
    data: { project, isRunning: false },
  })

  if (project.analysis) {
    nodes.push({
      id: 'analysis',
      type: 'analysis',
      position: { x: 0, y: 0 },
      data: { project, isRunning: isRunning('analysis') },
    })
    edges.push({ id: 'e-story-analysis', source: 'story', target: 'analysis' })
  }

  for (const char of project.characters) {
    const nodeId = `char-${char.id}`
    nodes.push({
      id: nodeId,
      type: 'character',
      position: { x: 0, y: 0 },
      data: { character: char, project, isRunning: isRunning('character') },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  for (const loc of project.locations) {
    const nodeId = `loc-${loc.id}`
    nodes.push({
      id: nodeId,
      type: 'location',
      position: { x: 0, y: 0 },
      data: { location: loc, project, isRunning: isRunning('location') },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  for (const shot of project.shots) {
    const nodeId = `shot-${shot.id}`
    nodes.push({
      id: nodeId,
      type: 'shot',
      position: { x: 0, y: 0 },
      data: { shot, project, isRunning: isRunning('shot') },
    })
    for (const charId of shot.characterIds) {
      edges.push({ id: `e-char-${charId}-${shot.id}`, source: `char-${charId}`, target: nodeId })
    }
    if (shot.locationId) {
      edges.push({ id: `e-loc-${shot.locationId}-${shot.id}`, source: `loc-${shot.locationId}`, target: nodeId })
    }
  }

  if (project.continuityIssues.length > 0) {
    nodes.push({
      id: 'continuity',
      type: 'continuityCheck',
      position: { x: 0, y: 0 },
      data: { project, isRunning: isRunning('continuityCheck') },
    })
    for (const shot of project.shots) {
      edges.push({ id: `e-shot-${shot.id}-cont`, source: `shot-${shot.id}`, target: 'continuity' })
    }
  }

  return { nodes, edges }
}

function CanvasFlowInner(props: {
  project: ProjectDTO
  runningPhase: string | null
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  const { project, runningPhase, onNodeClick } = props
  const { fitView, getNodes, getEdges } = useReactFlow()
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges] = useEdgesState<Edge>([])
  const fittedOnce = useRef(false)
  const savedPositions = useRef(new Map<string, { x: number, y: number }>())
  const measuredSig = useRef('')

  // Build nodes when project or running phase changes
  useEffect(() => {
    const { nodes: built, edges: builtEdges } = buildNodesAndEdges(project, runningPhase)

    // Merge with existing nodes to preserve positions and measurements
    const current = getNodes()
    const existing = new Map(current.map(n => [n.id, n]))

    const merged = built.map(n => {
      const prev = existing.get(n.id)
      if (prev) {
        return { ...n, position: prev.position, measured: prev.measured }
      }
      return n
    })

    // Run dagre layout
    const laidOut = computeLayout(merged, builtEdges)

    // Existing nodes keep their saved positions; new nodes get dagre positions
    const final = laidOut.map(n => {
      const saved = savedPositions.current.get(n.id)
      if (saved) {
        return { ...n, position: saved }
      }
      return n
    })

    setNodes(final)
    setEdges(builtEdges)
  }, [project, runningPhase])

  // After render: capture measurements and re-layout new nodes once
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const current = getNodes()
      if (current.length === 0) return

      // Find new nodes that have been measured but don't have saved positions yet
      const newlyMeasured = current.filter(
        n => !savedPositions.current.has(n.id) && n.measured?.height,
      )

      if (newlyMeasured.length === 0) {
        if (!fittedOnce.current) {
          setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 100)
          fittedOnce.current = true
        }
        return
      }

      // Build signature to avoid re-layout loops
      const sig = current.map(n => `${n.id}:${n.measured?.height ?? 0}`).join('|')
      if (sig === measuredSig.current) return
      measuredSig.current = sig

      // Re-layout with actual measurements
      const laidOut = computeLayout(current, getEdges())

      // Existing nodes keep positions; new nodes get updated positions and are saved
      const final = laidOut.map(n => {
        const saved = savedPositions.current.get(n.id)
        if (saved) {
          return { ...n, position: saved }
        }
        savedPositions.current.set(n.id, n.position)
        return n
      })

      setNodes(final)

      if (!fittedOnce.current) {
        setTimeout(() => fitView({ padding: 0.15, duration: 300 }), 100)
        fittedOnce.current = true
      }
    })
    return () => cancelAnimationFrame(raf)
  })

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick?.(node.id, node.type ?? '')
  }, [onNodeClick])

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      nodesDraggable={false}
      nodesConnectable={false}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
    >
      <Background />
      <Controls position="bottom-left" />
      <MiniMap position="bottom-right" nodeStrokeWidth={3} zoomable pannable />
    </ReactFlow>
  )
}

export default function CanvasFlow(props: {
  project: ProjectDTO
  runningPhase: string | null
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} />
    </ReactFlowProvider>
  )
}
