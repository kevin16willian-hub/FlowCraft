import { useRef } from 'react'
import { useReactFlow, type Edge } from '@xyflow/react'
import { containerKind, newId, sortParentsFirst, type FlowNode } from '../utils/graphMapping'

export type AlignMode = 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' | 'distribute-h' | 'distribute-v'

type Clipboard = { nodes: FlowNode[]; edges: Edge[]; pastes: number }

const PASTE_OFFSET = 24
const MIN_Z = -9

type Params = {
  nodes: FlowNode[]
  edges: Edge[]
  setNodes: (updater: (nodes: FlowNode[]) => FlowNode[]) => void
  setEdges: (updater: (edges: Edge[]) => Edge[]) => void
}

// Copiar/colar/duplicar, alinhar e ordenar camadas dos elementos selecionados.
export function useSelectionActions({ nodes, edges, setNodes, setEdges }: Params) {
  const { getInternalNode, deleteElements } = useReactFlow()
  const clipboard = useRef<Clipboard | null>(null)

  const selectedWithChildren = () => {
    const ids = new Set(nodes.filter((node) => node.selected).map((node) => node.id))
    let grew = true
    while (grew) {
      grew = false
      for (const node of nodes) {
        if (node.parentId && ids.has(node.parentId) && !ids.has(node.id)) { ids.add(node.id); grew = true }
      }
    }
    return nodes.filter((node) => ids.has(node.id))
  }

  const copy = () => {
    const picked = selectedWithChildren()
    if (!picked.length) return false
    const ids = new Set(picked.map((node) => node.id))
    clipboard.current = {
      nodes: picked.map((node) => {
        if (!node.parentId || ids.has(node.parentId)) return node
        const absolute = getInternalNode(node.id)?.internals.positionAbsolute ?? node.position
        return { ...node, parentId: undefined, position: { ...absolute } }
      }),
      edges: edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)),
      pastes: 0,
    }
    return true
  }

  const hasClipboard = () => clipboard.current !== null

  const paste = () => {
    const source = clipboard.current
    if (!source) return
    source.pastes += 1
    const offset = PASTE_OFFSET * source.pastes
    const idMap = new Map(source.nodes.map((node) => [node.id, newId(node.type ?? 'node')]))
    const copies: FlowNode[] = source.nodes.map((node) => {
      const root = !node.parentId || !idMap.has(node.parentId)
      return {
        ...node,
        id: idMap.get(node.id) as string,
        parentId: node.parentId && idMap.has(node.parentId) ? idMap.get(node.parentId) : undefined,
        position: root ? { x: node.position.x + offset, y: node.position.y + offset } : node.position,
        selected: root,
        data: { ...node.data },
      }
    })
    const edgeCopies: Edge[] = source.edges.map((edge) => ({ ...edge, id: newId('edge'), source: idMap.get(edge.source) as string, target: idMap.get(edge.target) as string, selected: false }))
    setNodes((current) => sortParentsFirst([...current.map((node) => ({ ...node, selected: false })), ...copies]))
    setEdges((current) => [...current.map((edge) => ({ ...edge, selected: false })), ...edgeCopies])
  }

  const duplicate = () => { if (copy()) paste() }

  const cut = () => {
    if (!copy()) return
    void deleteElements({ nodes: nodes.filter((node) => node.selected).map((node) => ({ id: node.id })) })
  }

  // Espaco livre igual entre os elementos, mantendo os dois das pontas.
  const distribute = (boxes: { id: string; x: number; y: number; width: number; height: number; origin: { x: number; y: number } }[], axis: 'x' | 'y') => {
    const size = axis === 'x' ? 'width' : 'height'
    const sorted = [...boxes].sort((a, b) => a[axis] - b[axis])
    const first = sorted[0]
    const last = sorted[sorted.length - 1]
    const total = last[axis] + last[size] - first[axis]
    const gap = (total - sorted.reduce((sum, box) => sum + box[size], 0)) / (sorted.length - 1)
    let cursor = first[axis]
    const moved = new Map<string, number>()
    for (const box of sorted) {
      moved.set(box.id, Math.round(cursor - box.origin[axis]))
      cursor += box[size] + gap
    }
    setNodes((current) => current.map((node) => (moved.has(node.id) ? { ...node, position: { ...node.position, [axis]: moved.get(node.id) as number } } : node)))
  }

  const align = (mode: AlignMode) => {
    const picked = nodes.filter((node) => node.selected)
    if (picked.length < (mode.startsWith('distribute') ? 3 : 2)) return
    const boxes = picked.map((node) => {
      const internal = getInternalNode(node.id)
      const parent = node.parentId ? getInternalNode(node.parentId) : undefined
      return {
        id: node.id,
        x: internal?.internals.positionAbsolute.x ?? node.position.x,
        y: internal?.internals.positionAbsolute.y ?? node.position.y,
        width: internal?.measured.width ?? node.width ?? 0,
        height: internal?.measured.height ?? node.height ?? 0,
        origin: parent?.internals.positionAbsolute ?? { x: 0, y: 0 },
      }
    })
    const left = Math.min(...boxes.map((box) => box.x))
    const right = Math.max(...boxes.map((box) => box.x + box.width))
    const top = Math.min(...boxes.map((box) => box.y))
    const bottom = Math.max(...boxes.map((box) => box.y + box.height))
    if (mode === 'distribute-h' || mode === 'distribute-v') {
      distribute(boxes, mode === 'distribute-h' ? 'x' : 'y')
      return
    }
    const moved = new Map(boxes.map((box) => {
      const x = mode === 'left' ? left : mode === 'right' ? right - box.width : mode === 'center' ? (left + right) / 2 - box.width / 2 : box.x
      const y = mode === 'top' ? top : mode === 'bottom' ? bottom - box.height : mode === 'middle' ? (top + bottom) / 2 - box.height / 2 : box.y
      return [box.id, { x: Math.round(x - box.origin.x), y: Math.round(y - box.origin.y) }]
    }))
    setNodes((current) => current.map((node) => (moved.has(node.id) ? { ...node, position: moved.get(node.id) as { x: number; y: number } } : node)))
  }

  // Containers (swimlanes) ficam sempre atras; a ordem vale entre os demais elementos.
  const reorder = (direction: 'front' | 'back') => {
    const regular = nodes.filter((node) => !containerKind(node.type, node.data.shapeKey))
    const selected = regular.filter((node) => node.selected)
    if (!selected.length) return
    const zs = regular.map((node) => node.zIndex ?? 0)
    const target = direction === 'front' ? Math.max(...zs) + 1 : Math.max(Math.min(...zs) - 1, MIN_Z)
    const ids = new Set(selected.map((node) => node.id))
    setNodes((current) => current.map((node) => (ids.has(node.id) ? { ...node, zIndex: target } : node)))
  }

  return { copy, paste, cut, duplicate, hasClipboard, align, reorder }
}
