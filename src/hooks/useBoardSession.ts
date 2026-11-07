import { useCallback, useEffect, useRef, useState } from 'react'
import { useEdgesState, useNodesState, type Edge } from '@xyflow/react'
import { ApiError, boardsApi } from '../api/client'
import type { BoardChanges, BoardMeta, Graph, Viewport } from '../types/board'
import type { Role } from '../types/board'
import { toApiGraph, toFlowEdges, toFlowNodes, type FlowNode } from '../utils/graphMapping'

export type SaveStatus = 'loading' | 'saved' | 'saving' | 'error' | 'conflict'

const AUTOSAVE_DELAY = 800
const VIEWPORT_DELAY = 1000

// Carrega um quadro e mantem a working copy sincronizada com a API (autosave com debounce e rowVersion).
export function useBoardSession(boardId: string | null) {
  const [meta, setMeta] = useState<BoardMeta | null>(null)
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [status, setStatus] = useState<SaveStatus>('loading')
  const [loadedId, setLoadedId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const readOnly = meta?.role === 'viewer' || meta?.protected === true

  const rowVersion = useRef<string | undefined>(undefined)
  // Pontes com o tempo real: quando ao vivo, o servidor persiste e o autosave por PUT fica desligado.
  const liveRef = useRef(false)
  const liveFlush = useRef<() => Promise<void>>(() => Promise.resolve())
  const remoteFlag = useRef(false)
  const latestGraph = useRef<Graph>({ nodes: [], edges: [] })
  const serverGraph = useRef<Graph>({ nodes: [], edges: [] })
  const revision = useRef(0)
  const lastSaved = useRef('')
  const latest = useRef('')
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const viewportTimer = useRef<number | undefined>(undefined)

  const enqueue = useCallback(<T,>(task: () => Promise<T>) => {
    const run = queue.current.then(task, task)
    queue.current = run.catch(() => undefined)
    return run
  }, [])

  useEffect(() => {
    if (!boardId) return undefined
    let cancelled = false
    void boardsApi.get(boardId).then((board) => {
      if (cancelled) return
      const flowNodes = toFlowNodes(board.nodes)
      const flowEdges = toFlowEdges(board.edges)
      rowVersion.current = board.rowVersion
      const loaded = toApiGraph(flowNodes, flowEdges)
      serverGraph.current = loaded
      latestGraph.current = loaded
      revision.current += 1
      lastSaved.current = JSON.stringify(loaded)
      latest.current = lastSaved.current
      setMeta(board)
      setDirty(board.dirty)
      setNodes(flowNodes)
      setEdges(flowEdges)
      setLoadedId(board.id)
      setStatus('saved')
    }).catch(() => { if (!cancelled) setStatus('error') })
    return () => { cancelled = true; setLoadedId(null); setStatus('loading') }
  }, [boardId, reloadKey, setEdges, setNodes])

  const persist = useCallback((id: string, payload: string) => enqueue(async () => {
    try {
      const saved = await boardsApi.saveGraph(id, { ...(JSON.parse(payload) as Graph), rowVersion: rowVersion.current })
      rowVersion.current = saved.rowVersion
      lastSaved.current = payload
      serverGraph.current = JSON.parse(payload) as Graph
      setDirty(saved.dirty ?? true)
      setStatus(latest.current === payload ? 'saved' : 'saving')
    } catch (cause) {
      setStatus(cause instanceof ApiError && cause.status === 409 ? 'conflict' : 'error')
    }
  }), [enqueue])

  useEffect(() => {
    if (!boardId || loadedId !== boardId || readOnly) return undefined
    const graph = toApiGraph(nodes, edges)
    const payload = JSON.stringify(graph)
    latest.current = payload
    latestGraph.current = graph
    revision.current += 1
    if (liveRef.current || payload === lastSaved.current) return undefined
    setStatus((current) => (current === 'conflict' ? current : 'saving'))
    const timer = window.setTimeout(() => { if (!liveRef.current) void persist(boardId, payload) }, AUTOSAVE_DELAY)
    return () => window.clearTimeout(timer)
  }, [boardId, loadedId, nodes, edges, persist, readOnly])

  const flush = useCallback(async () => {
    if (liveRef.current) { await liveFlush.current(); return }
    if (boardId && loadedId === boardId && latest.current !== lastSaved.current) await persist(boardId, latest.current)
  }, [boardId, loadedId, persist])

  // Ao fechar a aba, envia o que ainda nao foi salvo.
  useEffect(() => {
    const onPageHide = () => {
      if (!liveRef.current && boardId && loadedId === boardId && !readOnly && latest.current !== lastSaved.current && status !== 'conflict') {
        void boardsApi.saveGraph(boardId, { ...(JSON.parse(latest.current) as Graph), rowVersion: rowVersion.current }, true).catch(() => {})
      }
    }
    window.addEventListener('pagehide', onPageHide)
    return () => window.removeEventListener('pagehide', onPageHide)
  }, [boardId, loadedId, status, readOnly])

  const patch = useCallback((changes: BoardChanges) => {
    if (!boardId || readOnly) return Promise.resolve()
    return enqueue(async () => {
      const updated = await boardsApi.update(boardId, changes)
      rowVersion.current = updated.rowVersion
      setMeta(updated)
    })
  }, [boardId, enqueue, readOnly])

  const saveViewport = useCallback((viewport: Viewport) => {
    window.clearTimeout(viewportTimer.current)
    viewportTimer.current = window.setTimeout(() => { void patch({ viewport }).catch(() => {}) }, VIEWPORT_DELAY)
  }, [patch])

  const replaceGraph = useCallback((graph: Graph) => {
    setNodes(toFlowNodes(graph.nodes))
    setEdges(toFlowEdges(graph.edges))
  }, [setEdges, setNodes])

  // Recarrega a working copy do servidor (apos checkout/restauracao).
  const reload = useCallback(() => setReloadKey((current) => current + 1), [])

  // Atualiza meta, rowVersion e dirty sem tocar nos nos (apos commit).
  const refreshMeta = useCallback(() => {
    if (!boardId) return Promise.resolve()
    return enqueue(async () => {
      const board = await boardsApi.get(boardId)
      rowVersion.current = board.rowVersion
      setMeta(board)
      setDirty(board.dirty)
    })
  }, [boardId, enqueue])

  const getVersion = useCallback(() => rowVersion.current, [])
  const adoptVersion = useCallback((version: number) => { rowVersion.current = String(version) }, [])
  const applyRole = useCallback((role: Role) => setMeta((current) => (current ? { ...current, role } : current)), [])
  // Ao sair do modo ao vivo o servidor ja tem tudo: o estado local vira a nova base do autosave.
  const markSynced = useCallback(() => { lastSaved.current = latest.current; serverGraph.current = latestGraph.current }, [])

  return { meta, readOnly, getVersion, adoptVersion, applyRole, markSynced, setStatus, setDirty, liveRef, liveFlush, remoteFlag, latestGraph, serverGraph, revision, nodes, edges, status, dirty, ready: loadedId !== null && loadedId === boardId, setNodes, setEdges, onNodesChange, onEdgesChange, flush, patch, saveViewport, replaceGraph, reload, refreshMeta }
}
