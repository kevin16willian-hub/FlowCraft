import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { getViewportForBounds, useReactFlow } from '@xyflow/react'
import { toPng } from 'html-to-image'
import { boardsApi, uploadPrint } from '../../api/client'
import { useCurrentUser, useShapes } from '../../hooks/useApiData'
import { useComments } from '../../hooks/useComments'
import { useRealtime } from '../../hooks/useRealtime'
import { useBoardSession } from '../../hooks/useBoardSession'
import { useBoards } from '../../hooks/useBoards'
import { useHistory } from '../../hooks/useHistory'
import { useReview } from '../../hooks/useReview'
import { useSelectionActions } from '../../hooks/useSelectionActions'
import { useShortcuts } from '../../hooks/useShortcuts'
import { useTheme } from '../../hooks/useTheme'
import { useVersioning } from '../../hooks/useVersioning'
import type { BoardKind, Graph } from '../../types/board'
import { awsDefaultSize, awsFileOf, buildAwsNode, isAwsGroupFile } from '../../utils/awsCatalog'
import { useAwsCatalog } from '../../hooks/useAwsCatalog'
import { nextLaneFrame, nextPhaseSlot, normalizePool } from '../../utils/containerLayout'
import { buildNode, containerKind, sortParentsFirst, toApiGraph, toFlowEdges, toFlowNodes, type ContainerKind, type FlowNode } from '../../utils/graphMapping'
import { placeBeside } from '../../utils/mermaidImport'
import { FlowCanvas } from '../flow/FlowCanvas'
import { ReadOnlyContext } from '../flow/FlowNodes'
import { CollabPanel } from '../realtime/CollabPanel'
import { FollowBanner, ReactionBar, Roster, Toasts } from '../realtime/LiveControls'
import { RealtimeContext, type RealtimeContextValue } from '../realtime/RealtimeContext'
import { RemoteLayer } from '../realtime/RemoteLayer'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../ui/DropdownMenu'
import { Stack } from '../ui/Island'
import { MoonIcon, ShareIcon, SunIcon } from '../ui/icons'
import type { Notice } from '../../types/realtime'
import type { ChangeWithProposal } from '../../types/review'
import { ReviewPanel } from './ReviewPanel'
import { AdminPanel } from './AdminPanel'
import { BoardsPanel } from './BoardsPanel'
import { CompareDialog } from './CompareDialog'
import { MermaidImportDialog, type MermaidMode } from './MermaidImportDialog'
import { HelpButton, HelpDialog, UndoRedo, ZoomActions } from './FooterActions'
import { BACKGROUNDS, MainMenu } from './MainMenu'
import { SearchPanel } from './SearchPanel'
import { ShareDialog } from './ShareDialog'
import { TeamsPanel } from './TeamsPanel'
import { MAX_PRINTS, MultiSelectionPanel, SelectedNodePanel } from './SelectedNodePanel'
import { Toolbar, hintFor, toolsFor } from './Toolbar'
import { VersionsPanel } from './VersionsPanel'

const STATUS_LABELS = { loading: 'Carregando...', saved: 'Salvo', saving: 'Salvando...', error: 'Erro ao salvar', conflict: 'Quadro alterado em outra sessão — recarregue' } as const
const DRAG_THRESHOLD = 6
const MIN_SIZE = 40
const PRINT_MIN_HEIGHT = 140
const EXPORT_PADDING = 40
const TRANSPARENT_PIXEL = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

type Point = { x: number; y: number }
type ScreenRect = { x: number; y: number; width: number; height: number }

// Onde cada tipo de elemento pode ser encaixado: lanes/phases ficam em pools; os demais preferem lane > phase > pool.
const ACCEPTED_PARENTS: Record<ContainerKind | 'node', ContainerKind[]> = {
  pool: [], lane: ['pool'], phase: ['lane', 'pool'], node: ['phase', 'lane', 'pool'],
}

export function Studio() {
  const user = useCurrentUser()
  const theme = useTheme()
  const shapes = useShapes()
  const boards = useBoards()
  const session = useBoardSession(boards.currentId)
  const history = useHistory({ boardId: boards.currentId, ready: session.ready, nodes: session.nodes, edges: session.edges, setNodes: session.setNodes, setEdges: session.setEdges, remote: session.remoteFlag })
  const { screenToFlowPosition, getInternalNode, getNodes, getNodesBounds, fitView } = useReactFlow()
  const actions = useSelectionActions({ nodes: session.nodes, edges: session.edges, setNodes: session.setNodes, setEdges: session.setEdges })
  const containerRef = useRef<HTMLDivElement>(null)

  const [tool, setTool] = useState('select')
  const [locked, setLocked] = useState(false)
  const [boardsOpen, setBoardsOpen] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [mermaidOpen, setMermaidOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [teamsOpen, setTeamsOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [reviewCompare, setReviewCompare] = useState<ChangeWithProposal | null>(null)
  const [ghost, setGhost] = useState<ScreenRect | null>(null)

  const readOnly = session.readOnly
  const [collabTab, setCollabTab] = useState<'chat' | 'comments' | null>(null)
  const [laser, setLaser] = useState(false)
  const [notices, setNotices] = useState<(Notice & { action?: () => void; actionLabel?: string })[]>([])
  const noticeId = useRef(0)
  const lastCursor = useRef<Point | null>(null)

  const notify = (text: string, extra: { tone?: 'info' | 'warn'; action?: () => void; actionLabel?: string } = {}) => {
    const id = noticeId.current++
    setNotices((current) => [...current.slice(-3), { id, text, ...extra }])
    window.setTimeout(() => setNotices((current) => current.filter((item) => item.id !== id)), 7000)
  }

  const comments = useComments(boards.currentId, session.ready)
  const versioning = useVersioning(session)
  const review = useReview(boards.currentId, session.ready)
  const refreshReview = review.refresh
  // Quem revisa (dono ou time revisor) mantem "Revisão"; quem propõe vê "Mudanças".
  const reviewLabel = !review.change && (session.meta?.role === 'owner' || session.meta?.canReview) ? 'Revisão' : 'Mudanças'
  const reviewExtra = useMemo(() => (reviewCompare?.proposed ? [{ id: 'proposal', text: `Proposta: ${reviewCompare.title}`, graph: reviewCompare.proposed }] : []), [reviewCompare])
  // Apos perder o acesso (transferencia, remocao): volta para outro quadro.
  const leaveBoard = async () => {
    setShareOpen(false)
    const list = await boards.refresh()
    if (list.length) boards.open(list[0].id)
    else await boards.create('Meu primeiro quadro')
  }

  const rt = useRealtime(boards.currentId, session, {
    onNotify: (event) => {
      if (event.kind === 'mention') notify(`${event.by} mencionou você em "${event.boardName}": ${event.text ?? ''}`, { action: () => { if (event.boardId) boards.open(event.boardId) } })
      else if (event.kind === 'team') notify(`${event.by} adicionou você a um time`)
      else if (event.kind === 'review') { notify(`${event.by} ${event.text ?? 'atualizou uma revisão'}`, { action: () => { if (event.boardId) boards.open(event.boardId) } }); void refreshReview() }
      else notify(`${event.by} compartilhou ${event.boardName ? `"${event.boardName}"` : 'um quadro'} com você`, { action: () => { if (event.boardId) boards.open(event.boardId) } })
      void boards.refresh()
    },
    onVersion: (event) => {
      const what = { commit: 'registrou uma versão', branch: 'trocou de branch', 'branch-created': 'criou o branch', tag: 'criou a tag', restore: 'restaurou uma versão', protection: 'alterou a proteção do quadro' }[event.kind] ?? 'atualizou o histórico'
      notify(`${event.by} ${what}${event.message ? `: ${event.message}` : ''}`)
      void versioning.refresh().catch(() => {})
      if (event.kind !== 'restore') void session.refreshMeta()
    },
    onKicked: () => { notify('Você perdeu o acesso a este quadro.', { tone: 'warn' }); void leaveBoard() },
    onComment: comments.apply,
  })

  const heldNodeIds = useMemo(() => new Set(rt.peers.flatMap((peer) => peer.holding)), [rt.peers])
  // Em modo leitura (ou enquanto alguem arrasta o elemento) o draggable de cada no vale mais que a prop global do canvas.
  const visibleNodes = useMemo(
    () => (readOnly || heldNodeIds.size ? session.nodes.map((node) => (readOnly || heldNodeIds.has(node.id) ? { ...node, draggable: false } : node)) : session.nodes),
    [readOnly, heldNodeIds, session.nodes],
  )
  const createsNodes = !readOnly && tool !== 'select' && tool !== 'hand'
  const selectedNodes = session.nodes.filter((node) => node.selected)
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null
  const background = session.meta?.settings?.background ?? BACKGROUNDS[0]
  const boardKind: BoardKind = session.meta?.settings?.kind ?? 'flowchart'
  const awsItems = useAwsCatalog(boardKind === 'aws')
  useEffect(() => { setTool('select') }, [boards.currentId])

  const selectionKey = selectedNodes.map((node) => node.id).join(',')
  const { sendSelection, sendCursor, sendHolding, sendViewport, sendEditing, setFollowId } = rt
  useEffect(() => { sendSelection(selectionKey ? selectionKey.split(',') : []) }, [selectionKey, sendSelection])

  const openComments = (nodeId: string) => {
    session.setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })))
    setCollabTab('comments')
  }
  const liveContext = useMemo<RealtimeContextValue>(() => ({
    editorOf: (nodeId, field) => rt.peers.find((peer) => peer.editing?.nodeId === nodeId && peer.editing.field === field),
    heldBy: (nodeId) => rt.peers.find((peer) => peer.holding.includes(nodeId)),
    commentCount: (nodeId) => comments.counts.get(nodeId) ?? 0,
    commentTone: (nodeId) => comments.tones.get(nodeId),
    setEditing: (nodeId, field = '') => sendEditing(nodeId ? { nodeId, field } : null),
    openComments,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [rt.peers, comments.counts, comments.tones, sendEditing])

  const react = (emoji: string) => {
    const at = lastCursor.current ?? screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
    rt.sendReact(emoji, at.x, at.y)
  }

  const shortcuts = useMemo(() => {
    const map: Record<string, () => void> = { q: () => setLocked((current) => !current), escape: () => { setTool('select'); setSearchOpen(false) }, '?': () => setHelpOpen(true) }
    toolsFor(boardKind).forEach((item) => { map[item.key] = () => setTool(item.id) })
    return map
  }, [boardKind])
  useShortcuts(shortcuts)

  // Container mais especifico sob o centro do elemento (coordenadas absolutas do canvas).
  // Grupos AWS (VPC, subnet...) acolhem icones e grupos menores; selfArea evita aninhar um grupo dentro de si mesmo.
  const findContainer = (kind: ContainerKind | null, centerX: number, centerY: number, excludeId?: string, selfArea = 0) => {
    const accepted = ACCEPTED_PARENTS[kind ?? 'node']
    let best: { node: FlowNode; rank: number; area: number } | null = null
    for (const node of session.nodes) {
      const nodeKind = containerKind(node.type, node.data.shapeKey)
      const awsGroup = kind === null && isAwsGroupFile(awsFileOf(node.data.extra))
      const rank = nodeKind ? accepted.indexOf(nodeKind) : awsGroup ? 0 : -1
      if (node.id === excludeId || rank < 0) continue
      const internal = getInternalNode(node.id)
      if (!internal) continue
      const { x, y } = internal.internals.positionAbsolute
      const width = internal.measured.width ?? 0
      const height = internal.measured.height ?? 0
      if (centerX < x || centerX > x + width || centerY < y || centerY > y + height) continue
      const area = width * height
      if (awsGroup && area <= selfArea) continue
      if (!best || rank < best.rank || (rank === best.rank && area < best.area)) best = { node, rank, area }
    }
    return best?.node
  }

  const absoluteOrigin = (nodeId: string | undefined): Point => (nodeId ? getInternalNode(nodeId)?.internals.positionAbsolute : undefined) ?? { x: 0, y: 0 }

  const containerShape = (key: 'lane' | 'phase') => shapes.find((item) => item.key === key)

  // Lane nova: largura total da pool, empilhada; a pool cresce para contê-la.
  const addLane = (poolId: string) => {
    const shape = containerShape('lane')
    if (!shape) return
    session.setNodes((current) => {
      const pool = current.find((node) => node.id === poolId)
      if (!pool) return current
      const node = { ...buildNode(shape, nextLaneFrame(current, pool), poolId), selected: false }
      return normalizePool(sortParentsFirst([...current, node]), poolId)
    })
  }

  // Phase nova: divide a lane em colunas (ou vai a direita de formas soltas).
  const addPhase = (laneId: string) => {
    const shape = containerShape('phase')
    if (!shape) return
    session.setNodes((current) => {
      const lane = current.find((node) => node.id === laneId)
      if (!lane) return current
      const slot = nextPhaseSlot(current, lane)
      const node = { ...buildNode(shape, slot.frame, laneId), selected: false }
      const resized = current.map((item) => {
        const span = slot.resizes.find((entry) => entry.id === item.id)
        if (span) return { ...item, position: { ...item.position, x: span.x }, width: span.width }
        return item.id === laneId && !lane.parentId ? { ...item, width: slot.laneWidth } : item
      })
      const next = sortParentsFirst([...resized, node])
      return lane.parentId ? normalizePool(next, lane.parentId, slot.laneWidth) : next
    })
  }

  const fitPool = (poolId: string) => session.setNodes((current) => normalizePool(current, poolId))

  // Cria o elemento da ferramenta ativa: clique usa o tamanho padrao; arrastar define o tamanho.
  const placeNode = (from: Point, to: Point) => {
    const awsItem = tool.startsWith('aws:') ? awsItems.find((item) => item.key === tool) : undefined
    const shape = awsItem ? undefined : shapes.find((item) => item.key === tool)
    if (!shape && !awsItem) return
    const base = awsItem ? awsDefaultSize(awsItem) : shape!
    const dragged = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y)) >= DRAG_THRESHOLD
    const start = screenToFlowPosition({ x: Math.min(from.x, to.x), y: Math.min(from.y, to.y) })
    const end = screenToFlowPosition({ x: Math.max(from.x, to.x), y: Math.max(from.y, to.y) })
    const center = screenToFlowPosition(from)
    const width = dragged ? Math.max(Math.round(end.x - start.x), MIN_SIZE) : base.width
    const height = dragged ? Math.max(Math.round(end.y - start.y), MIN_SIZE) : base.height
    const x = dragged ? start.x : center.x - width / 2
    const y = dragged ? start.y : center.y - height / 2
    const kind = shape ? containerKind(shape.type, shape.key) : null
    const parent = findContainer(kind, x + width / 2, y + height / 2, undefined, width * height)
    if (shape && !dragged && parent && kind === 'lane' && containerKind(parent.type, parent.data.shapeKey) === 'pool') { addLane(parent.id); if (!locked) setTool('select'); return }
    if (shape && !dragged && parent && kind === 'phase' && containerKind(parent.type, parent.data.shapeKey) === 'lane') { addPhase(parent.id); if (!locked) setTool('select'); return }
    const origin = absoluteOrigin(parent?.id)
    const frame = { x: x - origin.x, y: y - origin.y, width, height }
    const node = awsItem ? buildAwsNode(awsItem, frame, parent?.id) : buildNode(shape!, frame, parent?.id)
    session.setNodes((current) => sortParentsFirst([...current.map((item) => ({ ...item, selected: false })), node]))
    if (!locked) setTool('select')
  }

  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!createsNodes || event.button !== 0 || !(event.target as HTMLElement).classList.contains('react-flow__pane')) return
    const origin = containerRef.current?.getBoundingClientRect()
    if (!origin) return
    const from = { x: event.clientX, y: event.clientY }
    const toRect = (to: Point): ScreenRect => ({ x: Math.min(from.x, to.x) - origin.left, y: Math.min(from.y, to.y) - origin.top, width: Math.abs(to.x - from.x), height: Math.abs(to.y - from.y) })
    const onMove = (move: PointerEvent) => setGhost(toRect({ x: move.clientX, y: move.clientY }))
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      setGhost(null)
      placeNode(from, { x: up.clientX, y: up.clientY })
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  // Soltar um elemento dentro de um container o torna filho dele; soltar fora desfaz o vinculo.
  const onNodeDragStart = (_: unknown, dragged: FlowNode) => sendHolding([...new Set([dragged.id, ...selectedNodes.map((node) => node.id)])])

  const onNodeDragStop = (_: unknown, dragged: FlowNode) => {
    sendHolding([])
    const internal = getInternalNode(dragged.id)
    if (!internal) return
    const absolute = internal.internals.positionAbsolute
    const target = findContainer(containerKind(dragged.type, dragged.data.shapeKey), absolute.x + (internal.measured.width ?? 0) / 2, absolute.y + (internal.measured.height ?? 0) / 2, dragged.id, (internal.measured.width ?? 0) * (internal.measured.height ?? 0))
    if ((target?.id ?? undefined) === dragged.parentId) return
    const origin = absoluteOrigin(target?.id)
    session.setNodes((current) => sortParentsFirst(current.map((node) => node.id === dragged.id
      ? { ...node, parentId: target?.id, position: { x: Math.round(absolute.x - origin.x), y: Math.round(absolute.y - origin.y) } }
      : node)))
  }

  const addPrint = async (nodeId: string, file: File) => {
    const node = session.nodes.find((item) => item.id === nodeId)
    if (!node || node.data.attachments.length >= MAX_PRINTS) return
    try {
      const print = await uploadPrint(file)
      session.setNodes((current) => current.map((item) => item.id === nodeId
        ? { ...item, height: item.type === 'stage' ? Math.max(item.height ?? item.measured?.height ?? 0, PRINT_MIN_HEIGHT) : item.height, data: { ...item.data, attachments: [...item.data.attachments, print] } }
        : item))
    } catch (cause) {
      window.alert(cause instanceof Error ? cause.message : 'Falha ao enviar a imagem')
    }
  }

  // Nao apaga o arquivo no S3: commits antigos ainda podem referenciar a imagem.
  const removePrint = (nodeId: string, name: string) => session.setNodes((current) => current.map((item) => item.id === nodeId
    ? { ...item, data: { ...item.data, attachments: item.data.attachments.filter((print) => print.name !== name) } }
    : item))

  const toggleLock = (node: FlowNode) => session.setNodes((current) => current.map((item) => item.id === node.id ? { ...item, draggable: item.draggable === false } : item))

  const pickSearchResult = (nodeId: string) => {
    session.setNodes((current) => current.map((node) => ({ ...node, selected: node.id === nodeId })))
    void fitView({ nodes: [{ id: nodeId }], duration: 300, maxZoom: 1.5, padding: 0.6 })
  }

  const exportImage = async () => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const all = getNodes()
    if (!viewport || all.length === 0) { window.alert('O quadro está vazio.'); return }
    const bounds = getNodesBounds(all)
    const width = Math.round(bounds.width + EXPORT_PADDING * 2)
    const height = Math.round(bounds.height + EXPORT_PADDING * 2)
    const transform = getViewportForBounds(bounds, width, height, 0.1, 4, EXPORT_PADDING / Math.max(width, height))
    const canvasColor = containerRef.current ? getComputedStyle(containerRef.current).getPropertyValue('--canvas-bg-color').trim() : ''
    try {
      const dataUrl = await toPng(viewport, {
        backgroundColor: canvasColor || '#ffffff',
        width,
        height,
        pixelRatio: 2,
        imagePlaceholder: TRANSPARENT_PIXEL,
        style: { width: `${width}px`, height: `${height}px`, transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})` },
        filter: (element) => !(element instanceof HTMLElement && (element.classList.contains('react-flow__node-toolbar') || element.classList.contains('react-flow__resize-control'))),
      })
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = `${(session.meta?.name ?? 'quadro').replace(/[^\w.-]+/g, '_')}.png`
      link.click()
    } catch {
      window.alert('Não foi possível gerar a imagem.')
    }
  }

  const handlers = useRef({ selected, addPrint, actions, readOnly })
  useEffect(() => { handlers.current = { selected, addPrint, actions, readOnly } })

  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null
      return !!element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable)
    }
    const onPaste = (event: ClipboardEvent) => {
      const { selected: target, addPrint: attach, actions: selection, readOnly: locked } = handlers.current
      if (locked) return
      const file = [...(event.clipboardData?.items ?? [])].find((item) => item.type.startsWith('image/'))?.getAsFile()
      if (file && target && (target.type === 'stage' || target.type === 'gateway')) { event.preventDefault(); void attach(target.id, file); return }
      if (isTyping(event.target) || !selection.hasClipboard()) return
      event.preventDefault()
      selection.paste()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || isTyping(event.target)) return
      const { actions: selection, readOnly: locked } = handlers.current
      const key = event.key.toLowerCase()
      if (key === 'f') { event.preventDefault(); setSearchOpen(true) }
      else if (locked) return
      else if (key === 'd') { event.preventDefault(); selection.duplicate() }
      else if (key === 'c') selection.copy()
      else if (key === 'x') { event.preventDefault(); selection.cut() }
    }
    window.addEventListener('paste', onPaste)
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('paste', onPaste); window.removeEventListener('keydown', onKeyDown) }
  }, [])

  const openBoards = () => { void boards.refresh(); setBoardsOpen(true) }
  const openBoard = async (id: string) => { await session.flush(); boards.open(id) }
  const createBoard = async (name: string, kind: BoardKind) => { await session.flush(); await boards.create(name, undefined, kind) }
  const duplicateBoard = async (id: string) => { await session.flush(); await boards.duplicate(id) }

  const renameBoard = async (id: string, name: string) => {
    if (id === boards.currentId) await session.patch({ name })
    else await boardsApi.update(id, { name })
    await boards.refresh()
  }

  const exportBoard = () => {
    const graph = toApiGraph(session.nodes, session.edges)
    const blob = new Blob([JSON.stringify({ format: 'flowcraft-board', version: 1, name: session.meta?.name, ...graph }, null, 2)], { type: 'application/json' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `${(session.meta?.name ?? 'quadro').replace(/[^\w.-]+/g, '_')}.json`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  const importBoard = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Partial<Graph>
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) throw new Error('formato inválido')
      if (window.confirm('Substituir o conteúdo do quadro atual pelo arquivo?')) session.replaceGraph({ nodes: parsed.nodes, edges: parsed.edges })
    } catch {
      window.alert('Arquivo inválido: use um JSON exportado pelo FlowCraft.')
    }
  }

  const importMermaid = (graph: Graph, mode: MermaidMode) => {
    setMermaidOpen(false)
    if (mode === 'replace') session.replaceGraph(graph)
    else {
      const placed = placeBeside(graph, session.nodes.filter((node) => !node.parentId).map((node) => ({ x: node.position.x, y: node.position.y, width: node.width ?? node.measured?.width })))
      session.setNodes((current) => sortParentsFirst([...current.map((item) => ({ ...item, selected: false })), ...toFlowNodes(placed.nodes)]))
      session.setEdges((current) => [...current, ...toFlowEdges(placed.edges)])
    }
    window.setTimeout(() => { void fitView({ padding: 0.2, maxZoom: 1, duration: 300 }) }, 100)
  }

  const clearBoard = () => { if (window.confirm('Limpar todo o quadro?')) session.replaceGraph({ nodes: [], edges: [] }) }
  const changeBackground = (color: string) => { void session.patch({ settings: { ...session.meta?.settings, background: color } }) }

  const containerStyle = (theme.resolved === 'dark' ? undefined : { '--canvas-bg-color': background }) as CSSProperties | undefined

  return (
    <RealtimeContext.Provider value={liveContext}>
    <div className="excalidraw-container" ref={containerRef} data-tool={tool} data-create={createsNodes} style={containerStyle}>
      {session.ready && boards.currentId && (
        <ReadOnlyContext.Provider value={readOnly}>
        <FlowCanvas
          key={boards.currentId}
          nodes={visibleNodes}
          edges={session.edges}
          tool={tool}
          creating={createsNodes}
          readOnly={readOnly}
          initialViewport={session.meta?.viewport ?? null}
          onNodesChange={session.onNodesChange}
          onEdgesChange={session.onEdgesChange}
          onEdgesUpdate={session.setEdges}
          onPointerDown={onCanvasPointerDown}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onViewportChange={session.saveViewport}
          onViewportMove={(viewport, byUser) => { sendViewport(viewport); if (byUser) setFollowId(null) }}
          onCursor={(point) => { lastCursor.current = point; sendCursor(point, laser) }}
        >
          <RemoteLayer peers={rt.peers} reactions={rt.reactions} />
        </FlowCanvas>
        </ReadOnlyContext.Provider>
      )}
      {ghost && <div className="create-ghost" style={{ left: ghost.x, top: ghost.y, width: ghost.width, height: ghost.height }} />}

      <div className="layer-ui__wrapper">
        <div className="FixedSideContainer FixedSideContainer_side_top">
          <div className="App-menu App-menu_top">
            <Stack direction="vertical" gap={6} className="App-menu_top__left">
              <Stack direction="horizontal" gap={2}>
                <MainMenu
                  user={user}
                  theme={theme.choice}
                  background={background}
                  readOnly={readOnly}
                  onShare={() => setShareOpen(true)}
                  onTeams={() => setTeamsOpen(true)}
                  onAdmin={() => setAdminOpen(true)}
                  onOpenBoards={openBoards}
                  onNewBoard={openBoards}
                  onImport={(file) => { void importBoard(file) }}
                  onImportMermaid={() => setMermaidOpen(true)}
                  onExport={exportBoard}
                  onExportImage={() => { void exportImage() }}
                  onSearch={() => setSearchOpen(true)}
                  onHelp={() => setHelpOpen(true)}
                  onVersions={() => setVersionsOpen(true)}
                  onClear={clearBoard}
                  onThemeChange={theme.setChoice}
                  onBackgroundChange={changeBackground}
                />
                <DropdownMenu triggerIcon={<span>{session.meta?.name ?? '...'}</span>} triggerTitle="Trocar de quadro" triggerClassName="board-switcher">
                  {boards.boards.map((board) => (
                    <DropdownMenuItem key={board.id} selected={board.id === boards.currentId} onSelect={() => { void openBoard(board.id) }}>{board.name}</DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={openBoards}>Gerenciar quadros...</DropdownMenuItem>
                </DropdownMenu>
              </Stack>
              {!readOnly && selected && (
                <SelectedNodePanel
                  node={selected}
                  onAddPrint={(file) => { void addPrint(selected.id, file) }}
                  onRemovePrint={(name) => removePrint(selected.id, name)}
                  onDuplicate={actions.duplicate}
                  onToggleLock={() => toggleLock(selected)}
                  onReorder={actions.reorder}
                  onAddChild={(kind) => (kind === 'lane' ? addLane(selected.id) : addPhase(selected.id))}
                  onFitPool={() => fitPool(selected.id)}
                />
              )}
              {!readOnly && selectedNodes.length >= 2 && (
                <MultiSelectionPanel count={selectedNodes.length} onAlign={actions.align} onDuplicate={actions.duplicate} onReorder={actions.reorder} />
              )}
            </Stack>

            <section className="shapes-section">
              {!readOnly && <Toolbar tool={tool} locked={locked} kind={boardKind} shapes={shapes} awsItems={awsItems} hint={hintFor(tool, shapes, awsItems)} onToolChange={setTool} onLockChange={setLocked} />}
              {readOnly && (session.meta?.protected
                ? <button type="button" className="role-chip role-chip--action" onClick={() => { setReviewOpen(true); void refreshReview() }}>Quadro protegido · proponha uma mudança</button>
                : <span className="role-chip">Somente leitura</span>)}
            </section>

            <div className="layer-ui__wrapper__top-right">
              <button type="button" className="excalidraw-button" title={theme.resolved === 'dark' ? 'Modo claro' : 'Modo escuro'} aria-label="Alternar modo escuro" onClick={() => theme.setChoice(theme.resolved === 'dark' ? 'light' : 'dark')}>{theme.resolved === 'dark' ? <SunIcon size={16} /> : <MoonIcon size={16} />}</button>
              <Roster realtime={rt} canPresent={!readOnly} chatOpen={collabTab !== null} onToggleChat={() => setCollabTab((current) => (current ? null : 'chat'))} />
              <button type="button" className="excalidraw-button" title={reviewLabel === 'Revisão' ? 'Revisão de mudanças' : 'Suas propostas de mudança'} onClick={() => { setReviewOpen(true); void refreshReview() }}>
                {reviewLabel}{review.change ? ` · ${review.change.status === 'open' ? 'aguardando' : review.change.status === 'merged' ? 'aprovada' : 'proposta'}` : ''}
                {review.pending > 0 && <span className="review-count" aria-label={`${review.pending} aguardando sua revisão`}>{review.pending}</span>}
              </button>
              <button type="button" className="excalidraw-button" title="Compartilhar este quadro" onClick={() => setShareOpen(true)}><ShareIcon size={16} /> Compartilhar</button>
              <button type="button" className="excalidraw-button versions-chip" title="Histórico de versões" onClick={() => setVersionsOpen(true)}>
                {versioning.currentBranch?.name ?? 'main'}
                <span className={`versions-chip__dot ${session.dirty ? 'versions-chip__dot--dirty' : ''}`} aria-label={session.dirty ? 'Alterações não registradas' : 'Sem alterações pendentes'} />
              </button>
              <span className={`status-chip status-chip--${session.status}`} role="status"><span className="status-chip__dot" />{boards.error ?? STATUS_LABELS[session.status]}</span>
            </div>
          </div>
        </div>

        <FollowBanner realtime={rt} />
        <ReactionBar realtime={rt} laser={laser} onLaser={setLaser} onReact={react} />
        {collabTab && (
          <CollabPanel
            tab={collabTab}
            onTabChange={setCollabTab}
            realtime={rt}
            comments={comments}
            user={user}
            focusNodeId={selected?.id ?? null}
            nodeTitle={(nodeId) => session.nodes.find((node) => node.id === nodeId)?.data.title ?? ''}
            onFocusNode={pickSearchResult}
            onClose={() => setCollabTab(null)}
          />
        )}
        <Toasts notices={notices} onDismiss={(id) => setNotices((current) => current.filter((item) => item.id !== id))} />

        {searchOpen && <SearchPanel nodes={session.nodes} onPick={pickSearchResult} onClose={() => setSearchOpen(false)} />}

        <footer className="layer-ui__wrapper__footer App-menu App-menu_bottom">
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <ZoomActions />
            <UndoRedo canUndo={history.canUndo} canRedo={history.canRedo} onUndo={history.undo} onRedo={history.redo} />
          </div>
          <HelpButton onClick={() => setHelpOpen(true)} />
        </footer>
      </div>

      {boardsOpen && (
        <BoardsPanel
          user={user}
          boards={boards.boards}
          currentId={boards.currentId}
          onOpen={(id) => { void openBoard(id) }}
          onCreate={createBoard}
          onRename={renameBoard}
          onDuplicate={duplicateBoard}
          onArchive={boards.archive}
          onDelete={boards.remove}
          onRestore={boards.restore}
          onClose={() => setBoardsOpen(false)}
        />
      )}
      {shareOpen && session.meta && <ShareDialog boardId={session.meta.id} boardName={session.meta.name} role={session.meta.role} onClose={() => setShareOpen(false)} onTransferred={() => { void leaveBoard() }} />}
      {teamsOpen && <TeamsPanel user={user} onOpenBoard={(id) => { void openBoard(id) }} onClose={() => setTeamsOpen(false)} />}
      {adminOpen && <AdminPanel user={user} onOpenBoard={(id) => { void openBoard(id) }} onClose={() => setAdminOpen(false)} />}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} />}
      {mermaidOpen && <MermaidImportDialog shapes={shapes} hasContent={session.nodes.length > 0} onImport={importMermaid} onClose={() => setMermaidOpen(false)} />}
      {reviewOpen && session.meta && (
        <ReviewPanel
          title={reviewLabel === 'Revisão' ? 'Revisão de mudanças' : 'Mudanças'}
          board={session.meta}
          isOwner={session.meta.role === 'owner'}
          change={review.change}
          onClose={() => setReviewOpen(false)}
          onOpenBoard={(id) => { setReviewOpen(false); void openBoard(id) }}
          onCompare={(change) => { setReviewOpen(false); setReviewCompare(change) }}
          onChanged={() => { void refreshReview(); void session.refreshMeta(); void boards.refresh() }}
        />
      )}
      {reviewCompare?.proposed && session.meta && (
        <CompareDialog
          boardId={session.meta.id}
          commits={versioning.commits}
          baseCommitId={reviewCompare.baseCommitId}
          workingGraph={toApiGraph(session.nodes, session.edges)}
          extra={reviewExtra}
          initial={{ left: reviewCompare.baseCommitId, right: 'proposal' }}
          onClose={() => setReviewCompare(null)}
        />
      )}
      {versionsOpen && <VersionsPanel versioning={versioning} dirty={session.dirty} readOnly={readOnly} onCompare={() => { setVersionsOpen(false); setCompareOpen(true) }} onClose={() => setVersionsOpen(false)} />}
      {compareOpen && session.meta && (
        <CompareDialog boardId={session.meta.id} commits={versioning.commits} baseCommitId={versioning.baseCommitId} workingGraph={toApiGraph(session.nodes, session.edges)} onClose={() => setCompareOpen(false)} />
      )}
    </div>
    </RealtimeContext.Provider>
  )
}
