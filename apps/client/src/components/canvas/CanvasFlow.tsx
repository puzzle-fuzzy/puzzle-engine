import type { Edge, Node, NodeTypes, OnNodesChange } from '@xyflow/react'
import type { ProjectDTO } from '@excuse/shared'
import { useCallback, useMemo } from 'react'
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'
import AnalysisNode from './nodes/AnalysisNode'
import CharacterNode from './nodes/CharacterNode'
import ContinuityCheckNode from './nodes/ContinuityCheckNode'
import LocationNode from './nodes/LocationNode'
import ShotNode from './nodes/ShotNode'
import StoryInputNode from './nodes/StoryInputNode'

const NODE_WIDTH = 340
const NODE_SEP = 60
const RANK_SEP = 100

const nodeTypes: NodeTypes = {
  storyInput: StoryInputNode,
  analysis: AnalysisNode,
  character: CharacterNode,
  location: LocationNode,
  shot: ShotNode,
  continuityCheck: ContinuityCheckNode,
}

function computeLayout(nodes: Node[], edges: Edge[]): Node[] {
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
    return {
      ...node,
      position: { x: pos.x - NODE_WIDTH / 2, y: pos.y - (node.measured?.height ?? 200) / 2 },
    }
  })
}

export function buildNodesAndEdges(project: ProjectDTO): { nodes: Node[], edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  // Story input
  nodes.push({
    id: 'story',
    type: 'storyInput',
    position: { x: 0, y: 0 },
    data: { project },
  })

  // Analysis
  if (project.analysis) {
    nodes.push({
      id: 'analysis',
      type: 'analysis',
      position: { x: 0, y: 0 },
      data: { project },
    })
    edges.push({ id: 'e-story-analysis', source: 'story', target: 'analysis', animated: false })
  }

  // Characters
  for (const char of project.characters) {
    const nodeId = `char-${char.id}`
    nodes.push({
      id: nodeId,
      type: 'character',
      position: { x: 0, y: 0 },
      data: { character: char, project },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  // Locations
  for (const loc of project.locations) {
    const nodeId = `loc-${loc.id}`
    nodes.push({
      id: nodeId,
      type: 'location',
      position: { x: 0, y: 0 },
      data: { location: loc, project },
    })
    if (project.analysis) {
      edges.push({ id: `e-analysis-${nodeId}`, source: 'analysis', target: nodeId })
    }
  }

  // Shots
  for (const shot of project.shots) {
    const nodeId = `shot-${shot.id}`
    nodes.push({
      id: nodeId,
      type: 'shot',
      position: { x: 0, y: 0 },
      data: { shot, project },
    })
    for (const charId of shot.characterIds) {
      edges.push({ id: `e-char-${charId}-${shot.id}`, source: `char-${charId}`, target: nodeId })
    }
    if (shot.locationId) {
      edges.push({ id: `e-loc-${shot.locationId}-${shot.id}`, source: `loc-${shot.locationId}`, target: nodeId })
    }
  }

  // Continuity check
  if (project.continuityIssues.length > 0) {
    nodes.push({
      id: 'continuity',
      type: 'continuityCheck',
      position: { x: 0, y: 0 },
      data: { project },
    })
    for (const shot of project.shots) {
      edges.push({ id: `e-shot-${shot.id}-cont`, source: `shot-${shot.id}`, target: 'continuity' })
    }
  }

  const laidOut = computeLayout(nodes, edges)
  return { nodes: laidOut, edges }
}

function CanvasFlowInner(props: {
  project: ProjectDTO
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  const { project, onNodeClick } = props
  const { fitView } = useReactFlow()

  const { nodes: initialNodes, edges } = useMemo(
    () => buildNodesAndEdges(project),
    [project],
  )

  const handleNodesChange: OnNodesChange = useCallback(() => {
    // readonly layout — ignore drag for now
  }, [])

  const handleNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeClick?.(node.id, node.type ?? '')
  }, [onNodeClick])

  return (
    <ReactFlow
      nodes={initialNodes}
      edges={edges}
      onNodesChange={handleNodesChange}
      onNodeClick={handleNodeClick}
      nodeTypes={nodeTypes}
      fitView
      onInit={() => {
        setTimeout(() => fitView({ padding: 0.15 }), 100)
      }}
      minZoom={0.1}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
      <Controls position="bottom-left" />
      <MiniMap
        position="bottom-right"
        nodeStrokeWidth={3}
        zoomable
        pannable
      />
    </ReactFlow>
  )
}

export default function CanvasFlow(props: {
  project: ProjectDTO
  onNodeClick?: (nodeId: string, nodeType: string) => void
}) {
  return (
    <ReactFlowProvider>
      <CanvasFlowInner {...props} />
    </ReactFlowProvider>
  )
}
