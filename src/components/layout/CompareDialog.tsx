import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from 'react'
import { getViewportForBounds, ReactFlow, ReactFlowProvider, type Edge, type Viewport } from '@xyflow/react'
import { boardsApi } from '../../api/client'
import type { ApiNode, CommitSummary, Graph } from '../../types/board'
import { absoluteBox, diffGraphs, nodeChanges, type FieldChange } from '../../utils/graphDiff'
import { toFlowEdges, toFlowNodes } from '../../utils/graphMapping'
import { nodeTypes, ReadOnlyContext } from '../flow/FlowNodes'

const WORKING = 'working'
const FOCUS_ZOOM = 1
const FIT_PADDING = 0.1
const NO_EXTRA: { id: string; text: string; graph: Graph }[] = []

type CompareDialogProps = {
  boardId: string
  commits: CommitSummary[]
  baseCommitId: string | null
  workingGraph: Graph
  // Versoes extras (ex.: proposta em revisao) e selecao inicial.
  extra?: { id: string; text: string; graph: Graph }[]
  initial?: { left?: string; right?: string }
  onClose: () => void
}

type Side = 'before' | 'after'
type Layout = 'columns' | 'rows'
type Diff = ReturnType<typeof diffGraphs>
type Entry = { id: string; kind: 'added' | 'removed' | 'changed'; title: string; changes: FieldChange[] }

const KIND_LABEL = { added: 'Adicionado', removed: 'Removido', changed: 'Alterado' } as const

function ReadOnlyBoard({ graph, side, diff, viewport, onViewportChange }: { graph: Graph; side: Side; diff: Diff; viewport: Viewport; onViewportChange: (viewport: Viewport) => void }) {
  const nodeClass = useMemo(() => {
    const marks = new Map<string, string>()
    diff.nodes.changed.forEach((node) => marks.set(node.id, 'diff-changed'))
    ;(side === 'before' ? diff.nodes.removed : diff.nodes.added).forEach((node) => marks.set(node.id, side === 'before' ? 'diff-removed' : 'diff-added'))
    return marks
  }, [diff, side])
  const edgeColor = useMemo(() => {
    const marks = new Map<string, string>()
    diff.edges.changed.forEach((edge) => marks.set(edge.id, '#f08c00'))
    ;(side === 'before' ? diff.edges.removed : diff.edges.added).forEach((edge) => marks.set(edge.id, side === 'before' ? '#e03131' : '#2f9e44'))
    return marks
  }, [diff, side])

  const nodes = useMemo(() => toFlowNodes(graph.nodes).map((node) => ({ ...node, className: nodeClass.get(node.id), selectable: false, draggable: false })), [graph, nodeClass])
  const edges = useMemo<Edge[]>(() => toFlowEdges(graph.edges).map((edge) => (edgeColor.has(edge.id) ? { ...edge, style: { stroke: edgeColor.get(edge.id), strokeWidth: 3 } } : edge)), [graph, edgeColor])

  return (
    <ReactFlowProvider>
      <ReadOnlyContext.Provider value>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          viewport={viewport}
          onViewportChange={onViewportChange}
          minZoom={0.05}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          proOptions={{ hideAttribution: true }}
        />
      </ReadOnlyContext.Provider>
    </ReactFlowProvider>
  )
}

const label = (commit: CommitSummary) => `#${commit.seq} · ${commit.message}`
const nameOf = (node: ApiNode) => node.title || node.shapeKey || node.type

export function CompareDialog({ boardId, commits, baseCommitId, workingGraph, extra = NO_EXTRA, initial, onClose }: CompareDialogProps) {
  const [left, setLeft] = useState(initial?.left ?? baseCommitId ?? commits[0]?.id ?? WORKING)
  const [right, setRight] = useState(initial?.right ?? WORKING)
  const [graphs, setGraphs] = useState<Record<string, Graph>>({})
  const [error, setError] = useState<string | null>(null)
  const [layout, setLayout] = useState<Layout>('columns')
  const [viewport, setViewport] = useState<Viewport | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const paneRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    const missing = [left, right].filter((id) => id !== WORKING && !graphs[id] && !extra.some((item) => item.id === id))
    if (!missing.length) return undefined
    void Promise.all(missing.map((id) => boardsApi.commitDetail(boardId, id).then((detail) => [id, detail.snapshot] as const)))
      .then((entries) => { if (!cancelled) setGraphs((current) => ({ ...current, ...Object.fromEntries(entries) })) })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'falha ao carregar versão') })
    return () => { cancelled = true }
  }, [boardId, left, right, graphs, extra])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const resolve = (id: string) => (id === WORKING ? workingGraph : extra.find((item) => item.id === id)?.graph ?? graphs[id])
  const before = resolve(left)
  const after = resolve(right)
  const diff = useMemo(() => (before && after ? diffGraphs(before, after) : null), [before, after])

  const entries = useMemo<Entry[]>(() => {
    if (!diff || !before) return []
    const previous = new Map(before.nodes.map((node) => [node.id, node]))
    return [
      ...diff.nodes.added.map((node): Entry => ({ id: node.id, kind: 'added', title: nameOf(node), changes: [] })),
      ...diff.nodes.removed.map((node): Entry => ({ id: node.id, kind: 'removed', title: nameOf(node), changes: [] })),
      ...diff.nodes.changed.map((node): Entry => ({ id: node.id, kind: 'changed', title: nameOf(node), changes: nodeChanges(previous.get(node.id) as ApiNode, node) })),
    ]
  }, [diff, before])

  const bounds = useMemo(() => {
    if (!before || !after) return null
    const boxes = [before, after].flatMap((graph) => {
      const all = new Map(graph.nodes.map((node) => [node.id, node]))
      return graph.nodes.map((node) => absoluteBox(node, all))
    })
    if (!boxes.length) return null
    const minX = Math.min(...boxes.map((box) => box.x))
    const minY = Math.min(...boxes.map((box) => box.y))
    return { x: minX, y: minY, width: Math.max(...boxes.map((box) => box.x + box.width)) - minX, height: Math.max(...boxes.map((box) => box.y + box.height)) - minY }
  }, [before, after])

  const fit = useCallback(() => {
    const rect = paneRef.current?.getBoundingClientRect()
    if (!rect || !rect.width) return
    setViewport(bounds ? getViewportForBounds(bounds, rect.width, rect.height, 0.05, 2, FIT_PADDING) : { x: 0, y: 0, zoom: 1 })
  }, [bounds])

  const ready = Boolean(before && after)
  // Reajusta ao carregar as versoes e ao trocar a orientacao dos paineis.
  useEffect(() => {
    if (!ready) return undefined
    const frame = requestAnimationFrame(fit)
    return () => cancelAnimationFrame(frame)
  }, [ready, layout, fit])

  const focus = (entry: Entry) => {
    setActiveId(entry.id)
    const rect = paneRef.current?.getBoundingClientRect()
    const source = (entry.kind === 'removed' ? before : after)?.nodes
    const node = source?.find((item) => item.id === entry.id)
    if (!rect || !node || !source) return
    const box = absoluteBox(node, new Map(source.map((item) => [item.id, item])))
    setViewport({ x: rect.width / 2 - (box.x + box.width / 2) * FOCUS_ZOOM, y: rect.height / 2 - (box.y + box.height / 2) * FOCUS_ZOOM, zoom: FOCUS_ZOOM })
  }

  const options = [{ id: WORKING, text: 'Cópia de trabalho (atual)' }, ...extra.map((item) => ({ id: item.id, text: item.text })), ...commits.map((commit) => ({ id: commit.id, text: label(commit) }))]
  const select = (value: string, set: (id: string) => void) => (
    <select className="versions-select" value={value} onChange={(event) => set(event.target.value)}>{options.map((option) => <option key={option.id} value={option.id}>{option.text}</option>)}</select>
  )
  const pane = (side: Side, graph: Graph | undefined, caption: string, ref?: Ref<HTMLDivElement>) => (
    <div className="compare-full__pane" ref={ref}>
      <span className="compare-full__caption">{caption}</span>
      {graph && diff && viewport ? <ReadOnlyBoard graph={graph} side={side} diff={diff} viewport={viewport} onViewportChange={setViewport} /> : <span className="compare-full__loading">Carregando...</span>}
    </div>
  )

  return (
    <div className="compare-full" role="dialog" aria-modal="true" aria-label="Comparar versões">
      <header className="compare-full__bar">
        <button type="button" className="excalidraw-button compare-full__back" onClick={onClose}>← Voltar ao projeto atual</button>
        <strong>Comparar versões</strong>
        <label className="compare-full__select">Antes {select(left, setLeft)}</label>
        <label className="compare-full__select">Depois {select(right, setRight)}</label>
        <div className="compare-full__layout" role="group" aria-label="Disposição">
          <button type="button" className={`excalidraw-button ${layout === 'columns' ? 'is-active' : ''}`} onClick={() => setLayout('columns')} title="Lado a lado">Lado a lado</button>
          <button type="button" className={`excalidraw-button ${layout === 'rows' ? 'is-active' : ''}`} onClick={() => setLayout('rows')} title="Um embaixo do outro">Empilhado</button>
          <button type="button" className="excalidraw-button" onClick={fit} title="Enquadrar tudo">Ajustar</button>
        </div>
      </header>
      {error && <p role="alert" className="compare-full__error">{error}</p>}
      {diff && (
        <p className="compare__summary compare-full__summary">
          <span className="compare__badge compare__badge--added">+{diff.nodes.added.length} adicionados</span>
          <span className="compare__badge compare__badge--removed">−{diff.nodes.removed.length} removidos</span>
          <span className="compare__badge compare__badge--changed">~{diff.nodes.changed.length} alterados</span>
          <span className="compare__badge">setas: +{diff.edges.added.length} −{diff.edges.removed.length} ~{diff.edges.changed.length}</span>
        </p>
      )}
      <div className="compare-full__body">
        <div className={`compare-full__panes compare-full__panes--${layout}`}>
          {pane('before', before, 'Antes', paneRef)}
          {pane('after', after, 'Depois')}
        </div>
        <aside className="compare-full__cards" aria-label="Diferenças">
          {diff && entries.length === 0 && <p className="compare-full__empty">Nenhuma diferença entre as versões.</p>}
          {entries.map((entry) => (
            <button type="button" key={`${entry.kind}-${entry.id}`} className={`diff-card diff-card--${entry.kind} ${activeId === entry.id ? 'is-active' : ''}`} onClick={() => focus(entry)}>
              <span className="diff-card__kind">{KIND_LABEL[entry.kind]}</span>
              <strong className="diff-card__title">{entry.title}</strong>
              {entry.changes.map((change) => (
                <span key={change.field} className="diff-card__change">
                  <em>{change.field}</em>
                  <del>{change.before || '(vazio)'}</del>
                  <ins>{change.after || '(vazio)'}</ins>
                </span>
              ))}
            </button>
          ))}
        </aside>
      </div>
    </div>
  )
}
