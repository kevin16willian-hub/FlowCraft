import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react'
import type { Edge } from '@xyflow/react'
import { diffOps, touched } from '../utils/graphOps'
import { sortParentsFirst, toApiGraph, type FlowNode } from '../utils/graphMapping'

type Snapshot = { nodes: FlowNode[]; edges: Edge[] }
type Step = { before: Snapshot; after: Snapshot }

type HistoryInput = {
  boardId: string | null
  ready: boolean
  nodes: FlowNode[]
  edges: Edge[]
  setNodes: (nodes: FlowNode[]) => void
  setEdges: (edges: Edge[]) => void
  remote: MutableRefObject<boolean>
}

const LIMIT = 100
const BURST_MS = 400

const keyOf = (snapshot: Snapshot) => JSON.stringify(toApiGraph(snapshot.nodes, snapshot.edges))

// Undo/redo por pessoa: cada passo guarda antes/depois e so reverte os elementos que ESSA pessoa alterou;
// mudancas de colegas (remote) nunca entram no historico nem sao desfeitas.
export function useHistory({ boardId, ready, nodes, edges, setNodes, setEdges, remote }: HistoryInput) {
  const past = useRef<Step[]>([])
  const future = useRef<Step[]>([])
  const base = useRef<Snapshot | null>(null)
  const pending = useRef<Snapshot | null>(null)
  const latest = useRef<Snapshot | null>(null)
  const key = useRef('')
  const applying = useRef(false)
  const timer = useRef<number | undefined>(undefined)
  const [counts, setCounts] = useState({ undo: 0, redo: 0 })

  const sync = useCallback(() => setCounts({ undo: past.current.length, redo: future.current.length }), [])

  useEffect(() => {
    window.clearTimeout(timer.current)
    past.current = []; future.current = []; base.current = null; pending.current = null; latest.current = null; key.current = ''
    sync()
  }, [boardId, sync])

  const commit = useCallback(() => {
    window.clearTimeout(timer.current)
    if (!pending.current || !latest.current) return
    past.current.push({ before: pending.current, after: latest.current })
    if (past.current.length > LIMIT) past.current.shift()
    pending.current = null
    future.current = []
    base.current = latest.current
    sync()
  }, [sync])

  useEffect(() => {
    if (!ready) return
    const snapshot = { nodes, edges }
    const current = keyOf(snapshot)
    latest.current = snapshot
    if (remote.current) {
      remote.current = false
      key.current = current
      if (!pending.current) base.current = snapshot
      return
    }
    if (applying.current) { applying.current = false; key.current = current; base.current = snapshot; return }
    if (base.current === null) { base.current = snapshot; key.current = current; return }
    if (current === key.current) return
    key.current = current
    pending.current ??= base.current
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(commit, BURST_MS)
  }, [ready, nodes, edges, commit, remote])

  // Leva para `target` so os elementos que diferem entre `source` e `target`, mantendo o resto como esta agora.
  const restore = useCallback((target: Snapshot, source: Snapshot) => {
    const delta = touched(diffOps(toApiGraph(source.nodes, source.edges), toApiGraph(target.nodes, target.edges)))
    const targetNodes = new Map(target.nodes.map((node) => [node.id, node]))
    const targetEdges = new Map(target.edges.map((edge) => [edge.id, edge]))
    const nextNodes = new Map(nodes.map((node) => [node.id, { ...node, selected: false }]))
    const nextEdges = new Map(edges.map((edge) => [edge.id, { ...edge, selected: false }]))
    delta.nodes.forEach((id) => {
      const node = targetNodes.get(id)
      if (node) nextNodes.set(id, { ...node, selected: false }); else nextNodes.delete(id)
    })
    delta.edges.forEach((id) => {
      const edge = targetEdges.get(id)
      if (edge) nextEdges.set(id, { ...edge, selected: false }); else nextEdges.delete(id)
    })
    applying.current = true
    setNodes(sortParentsFirst([...nextNodes.values()]))
    setEdges([...nextEdges.values()].filter((edge) => nextNodes.has(edge.source) && nextNodes.has(edge.target)))
  }, [edges, nodes, setEdges, setNodes])

  const undo = useCallback(() => {
    commit()
    const step = past.current.pop()
    if (!step) return
    future.current.push(step)
    restore(step.before, step.after)
    sync()
  }, [commit, restore, sync])

  const redo = useCallback(() => {
    const step = future.current.pop()
    if (!step) return
    past.current.push(step)
    restore(step.after, step.before)
    sync()
  }, [restore, sync])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey)) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return
      const pressed = event.key.toLowerCase()
      if (pressed === 'z' && !event.shiftKey) { event.preventDefault(); undo() }
      else if (pressed === 'y' || (pressed === 'z' && event.shiftKey)) { event.preventDefault(); redo() }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undo, redo])

  return { undo, redo, canUndo: counts.undo > 0, canRedo: counts.redo > 0 }
}
