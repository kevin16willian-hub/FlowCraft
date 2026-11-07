import { useEffect, useState } from 'react'
import { MarkerType, NodeToolbar, Position, useReactFlow, type Edge } from '@xyflow/react'
import { boardsApi } from '../../api/client'
import type { Shape } from '../../types/board'
import { buildNode, gatewayBranch, newId, type FlowNode } from '../../utils/graphMapping'
import { SHAPE_ICONS } from '../ui/shapeIcons'

const GAP = 80

const SIDES = [
  { id: 't', position: Position.Top, opposite: 'b', label: 'acima' },
  { id: 'r', position: Position.Right, opposite: 'l', label: 'à direita' },
  { id: 'b', position: Position.Bottom, opposite: 't', label: 'abaixo' },
  { id: 'l', position: Position.Left, opposite: 'r', label: 'à esquerda' },
] as const

type Side = (typeof SIDES)[number]

const cache = new Map<string, Shape[]>()

// Setas ao redor do elemento selecionado (estilo Visio): a paleta sugere o proximo elemento, ja conectado.
export function NodeSuggestions({ nodeId, fromKey }: { nodeId: string; fromKey: string }) {
  const { getNode, getEdges, setNodes, addEdges } = useReactFlow<FlowNode, Edge>()
  const [open, setOpen] = useState<Side['id'] | null>(null)
  const [suggestions, setSuggestions] = useState<Shape[]>(() => cache.get(fromKey) ?? [])

  useEffect(() => {
    const cached = cache.get(fromKey)
    if (cached) { setSuggestions(cached); return undefined }
    let cancelled = false
    void boardsApi.suggestions(fromKey, 5).then((list) => {
      cache.set(fromKey, list)
      if (!cancelled) setSuggestions(list)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [fromKey])

  const create = (shape: Shape, side: Side) => {
    const source = getNode(nodeId)
    if (!source) return
    const sourceWidth = source.width ?? source.measured?.width ?? 120
    const sourceHeight = source.height ?? source.measured?.height ?? 60
    const { x, y } = source.position
    const frame = {
      r: { x: x + sourceWidth + GAP, y: y + sourceHeight / 2 - shape.height / 2 },
      l: { x: x - GAP - shape.width, y: y + sourceHeight / 2 - shape.height / 2 },
      b: { x: x + sourceWidth / 2 - shape.width / 2, y: y + sourceHeight + GAP },
      t: { x: x + sourceWidth / 2 - shape.width / 2, y: y - GAP - shape.height },
    }[side.id]
    const node = buildNode(shape, { ...frame, width: shape.width, height: shape.height }, source.parentId)
    const { branch, label } = source.type === 'gateway' ? gatewayBranch(getEdges(), nodeId) : { branch: null, label: undefined }

    setNodes((current) => [...current.map((item) => ({ ...item, selected: false })), node])
    addEdges({ id: newId('edge'), source: nodeId, target: node.id, sourceHandle: side.id, targetHandle: side.opposite, type: 'smoothstep', label, markerEnd: { type: MarkerType.ArrowClosed }, data: { branch } })
    void boardsApi.recordUsage(fromKey, shape.key).then(() => cache.delete(fromKey)).catch(() => {})
    setOpen(null)
  }

  return (
    <>
      {SIDES.map((side) => (
        <NodeToolbar key={side.id} nodeId={nodeId} position={side.position} offset={10}>
          <div className="suggest" onMouseEnter={() => setOpen(side.id)} onMouseLeave={() => setOpen(null)}>
            <button type="button" className={`suggest__arrow suggest__arrow--${side.id}`} aria-label={`Adicionar elemento ${side.label}`} onClick={() => setOpen(side.id)}>
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 14 L10 4 L18 14 Z" /><circle cx="10" cy="13" r="1.6" /></svg>
            </button>
            {open === side.id && suggestions.length > 0 && (
              <div className={`suggest__palette suggest__palette--${side.id}`} role="menu">
                {suggestions.map((shape) => (
                  <button key={shape.key} type="button" role="menuitem" className="suggest__item" title={shape.label} aria-label={shape.label} onClick={() => create(shape, side)}>
                    {SHAPE_ICONS[shape.key]}
                  </button>
                ))}
              </div>
            )}
          </div>
        </NodeToolbar>
      ))}
    </>
  )
}
