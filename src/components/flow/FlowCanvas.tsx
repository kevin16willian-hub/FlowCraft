import { ConnectionMode, MarkerType, ReactFlow, ViewportPortal, addEdge, useReactFlow, type Connection, type Edge, type NodeChange, type OnEdgesChange, type OnNodesChange, type Viewport } from '@xyflow/react'
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { computeSnap, type Guide, type Rect } from '../../utils/snapGuides'
import type { FlowNode } from '../../utils/graphMapping'
import { containerKind, gatewayBranch, newId } from '../../utils/graphMapping'
import { nodeTypes } from './FlowNodes'

const SNAP_THRESHOLD = 6

export type Tool = 'select' | 'hand' | string

type FlowCanvasProps = {
  nodes: FlowNode[]
  edges: Edge[]
  tool: Tool
  creating: boolean
  readOnly: boolean
  initialViewport: Viewport | null
  onNodesChange: OnNodesChange<FlowNode>
  onEdgesChange: OnEdgesChange<Edge>
  onEdgesUpdate: (updater: (edges: Edge[]) => Edge[]) => void
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void
  onNodeDragStart: (event: unknown, node: FlowNode) => void
  onNodeDragStop: (event: unknown, node: FlowNode) => void
  onViewportChange: (viewport: Viewport) => void
  onViewportMove: (viewport: Viewport, byUser: boolean) => void
  onCursor: (point: { x: number; y: number } | null) => void
  children?: ReactNode
}

export function FlowCanvas({ nodes, edges, tool, creating, readOnly, initialViewport, onNodesChange, onEdgesChange, onEdgesUpdate, onPointerDown, onNodeDragStart, onNodeDragStop, onViewportChange, onViewportMove, onCursor, children }: FlowCanvasProps) {
  const { getNode, getNodes, getInternalNode, getViewport, screenToFlowPosition } = useReactFlow()
  const [guides, setGuides] = useState<Guide[]>([])
  const altPressed = useRef(false)
  const handTool = tool === 'hand'
  const locked = handTool || creating

  useEffect(() => {
    const track = (event: KeyboardEvent) => { altPressed.current = event.altKey }
    window.addEventListener('keydown', track)
    window.addEventListener('keyup', track)
    return () => { window.removeEventListener('keydown', track); window.removeEventListener('keyup', track) }
  }, [])

  const absoluteRect = (id: string): Rect | null => {
    const internal = getInternalNode(id)
    if (!internal || !internal.measured.width || !internal.measured.height) return null
    const { x, y } = internal.internals.positionAbsolute
    return { x, y, width: internal.measured.width, height: internal.measured.height }
  }

  // Guias estilo PowerPoint: um unico elemento arrastado gruda nos vizinhos; Alt solta o encaixe.
  const handleNodesChange: OnNodesChange<FlowNode> = (changes) => {
    // Ao soltar o React Flow emite a posicao crua do ponteiro; sem encaixar de novo o elemento sai do alinhamento.
    const dragging = changes.filter((change): change is Extract<NodeChange<FlowNode>, { type: 'position' }> => change.type === 'position' && change.dragging !== undefined && !!change.position)
    const dropped = dragging.length > 0 && dragging.every((change) => change.dragging === false)
    if (changes.some((change) => change.type === 'position' && change.dragging === false)) setGuides([])
    if (dragging.length !== 1 || altPressed.current) {
      if (dragging.length) setGuides([])
      onNodesChange(changes)
      return
    }

    const change = dragging[0]
    const internal = getInternalNode(change.id)
    const nodes = getNodes() as FlowNode[]
    const self = nodes.find((node) => node.id === change.id)
    const size = absoluteRect(change.id)
    if (!internal || !self || !size || !change.position) { onNodesChange(changes); return }
    const parentOrigin = internal.parentId ? getInternalNode(internal.parentId)?.internals.positionAbsolute ?? { x: 0, y: 0 } : { x: 0, y: 0 }
    const moving: Rect = { ...size, x: parentOrigin.x + change.position.x, y: parentOrigin.y + change.position.y }

    const excluded = new Set([change.id])
    let grew = true
    while (grew) {
      grew = false
      for (const node of nodes) if (node.parentId && excluded.has(node.parentId) && !excluded.has(node.id)) { excluded.add(node.id); grew = true }
    }
    const movingIsContainer = containerKind(self.type, self.data.shapeKey) !== null
    const others = nodes
      .filter((node) => !excluded.has(node.id) && (containerKind(node.type, node.data.shapeKey) !== null) === movingIsContainer)
      .map((node) => absoluteRect(node.id))
      .filter((rect): rect is Rect => rect !== null)

    const { dx, dy, guides: found } = computeSnap(moving, others, SNAP_THRESHOLD / getViewport().zoom)
    setGuides(dropped ? [] : found)
    onNodesChange(changes.map((item) => (item === change ? { ...change, position: { x: (change.position?.x ?? 0) + dx, y: (change.position?.y ?? 0) + dy } } : item)))
  }

  // Saidas de uma condicional recebem "Sim" e depois "Nao" automaticamente.
  const onConnect = (connection: Connection) => onEdgesUpdate((current) => {
    const { branch, label } = getNode(connection.source)?.type === 'gateway' ? gatewayBranch(current, connection.source) : { branch: null, label: undefined }
    return addEdge({ ...connection, id: newId('edge'), type: 'smoothstep', label, markerEnd: { type: MarkerType.ArrowClosed }, data: { branch } }, current)
  })

  const onEdgeDoubleClick = (_: unknown, edge: Edge) => {
    if (readOnly) return
    const next = window.prompt('Rótulo da seta (vazio remove)', typeof edge.label === 'string' ? edge.label : '')
    if (next === null) return
    onEdgesUpdate((current) => current.map((item) => (item.id === edge.id ? { ...item, label: next.trim() || undefined } : item)))
  }

  return (
    <div className="excalidraw__canvas-wrapper" onPointerMove={(event) => onCursor(screenToFlowPosition({ x: event.clientX, y: event.clientY }))} onPointerLeave={() => onCursor(null)}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onPointerDown={onPointerDown}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onMove={(event, viewport) => onViewportMove(viewport, event !== null)}
        onMoveEnd={(_, viewport) => onViewportChange(viewport)}
        connectionMode={ConnectionMode.Loose}
        defaultViewport={initialViewport ?? undefined}
        fitView={!initialViewport}
        fitViewOptions={{ padding: 0.3, maxZoom: 1 }}
        minZoom={0.1}
        maxZoom={4}
        nodesDraggable={!locked && !readOnly}
        nodesConnectable={!handTool && !readOnly}
        elementsSelectable={!handTool}
        selectionOnDrag={!locked}
        panOnDrag={handTool ? true : [1]}
        panOnScroll
        panActivationKeyCode="Space"
        deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
        proOptions={{ hideAttribution: true }}
      >
        {children}
        {guides.length > 0 && (
          <ViewportPortal>
            <svg className="snap-guides" width={1} height={1}>
              {guides.map((guide) => (guide.axis === 'x'
                ? <line key={`x${guide.position}`} x1={guide.position} x2={guide.position} y1={guide.start} y2={guide.end} />
                : <line key={`y${guide.position}`} x1={guide.start} x2={guide.end} y1={guide.position} y2={guide.position} />))}
            </svg>
          </ViewportPortal>
        )}
      </ReactFlow>
    </div>
  )
}
