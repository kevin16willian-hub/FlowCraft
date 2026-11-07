import { useCallback, useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import type { Role, Viewport } from '../types/board'
import type { ChatMessage, CommentItem, LiveStatus, Ops, Peer, Reaction, RemoteState, ServerEvent } from '../types/realtime'
import { applyOps, diffOps, isEmptyOps } from '../utils/graphOps'
import { sortParentsFirst, toApiGraph, toFlowEdges, toFlowNodes } from '../utils/graphMapping'
import type { useBoardSession } from './useBoardSession'

type Session = ReturnType<typeof useBoardSession>

export type RealtimeHandlers = {
  onNotify: (event: Extract<ServerEvent, { t: 'notify' }>) => void
  onVersion: (event: Extract<ServerEvent, { t: 'version' }>) => void
  onKicked: () => void
  onComment: (action: 'add' | 'update' | 'delete', comment: CommentItem) => void
}

const TICK_MS = 100
const OPS_INTERVAL_MS = 300
const IDLE_MS = 120_000
const HIDDEN_MS = 30_000
const REACTION_MS = 2500
const MAX_FAILURES = 3
const OFFLINE_RETRY_MS = 30_000

// Forma canonica de um elemento remoto, igual a que o canvas gera ao exportar (evita eco de operacoes).
const canonicalNode = (node: Ops['nodes'][number]) => toApiGraph(toFlowNodes([node]), []).nodes[0]
const canonicalEdge = (edge: Ops['edges'][number]) => toApiGraph([], toFlowEdges([edge])).edges[0]

type Outbox = Partial<RemoteState> & { chat?: string }

// Canal ao vivo do quadro: abre quando a pessoa interage, fecha apos inatividade e recupera o que perdeu ao voltar.
export function useRealtime(boardId: string | null, session: Session, handlers: RealtimeHandlers) {
  const { setViewport } = useReactFlow()
  const [status, setStatus] = useState<LiveStatus>('off')
  const [peers, setPeers] = useState<Peer[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [readCount, setReadCount] = useState(0)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [followId, setFollowId] = useState<string | null>(null)
  const [myColor, setMyColor] = useState('#1971c2')
  const [presenting, setPresentingState] = useState(false)

  const clientId = useRef(crypto.randomUUID())
  const source = useRef<EventSource | null>(null)
  const known = useRef(0)
  const outbox = useRef<Outbox>({})
  const lastOpsAt = useRef(0)
  const lastRevision = useRef(-1)
  const inflight = useRef<Promise<unknown>>(Promise.resolve())
  const pendingRemote = useRef<Ops[]>([])
  const lastActivity = useRef(Date.now())
  const hiddenSince = useRef<number | null>(null)
  const failures = useRef(0)
  const retryTimer = useRef<number | undefined>(undefined)
  const kicked = useRef(false)
  const stateRef = useRef<Partial<RemoteState>>({})
  const reactionKey = useRef(0)
  const handlersRef = useRef(handlers)
  const followRef = useRef<string | null>(null)
  const peersRef = useRef<Peer[]>([])
  const roleRef = useRef<Role>('viewer')

  useEffect(() => { handlersRef.current = handlers })
  useEffect(() => { followRef.current = followId }, [followId])
  useEffect(() => { peersRef.current = peers }, [peers])
  useEffect(() => { roleRef.current = session.meta?.role ?? 'viewer' }, [session.meta?.role])

  const post = useCallback((body: Record<string, unknown>, keepalive = false) => {
    if (!boardId) return
    const id = boardId
    inflight.current = inflight.current.then(() => fetch(`/api/boards/${id}/rt`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: clientId.current, ...body }), keepalive,
    }).then((response) => {
      if (!response.ok && body.ops && response.status !== 429) session.reload()
    })).catch(() => {})
  }, [boardId, session])

  const tick = useCallback((keepalive = false) => {
    if (!session.liveRef.current) return
    const out: Record<string, unknown> = { ...outbox.current }
    outbox.current = {}
    const now = Date.now()
    if (roleRef.current !== 'viewer' && now - lastOpsAt.current >= OPS_INTERVAL_MS && session.revision.current !== lastRevision.current) {
      lastRevision.current = session.revision.current
      const ops = diffOps(session.serverGraph.current, session.latestGraph.current)
      if (!isEmptyOps(ops)) {
        session.serverGraph.current = applyOps(session.serverGraph.current, ops)
        lastOpsAt.current = now
        out.ops = ops
        session.setStatus('saving')
      }
    }
    if (Object.keys(out).length) post(out, keepalive)
  }, [post, session])

  const tickRef = useRef(tick)
  useEffect(() => { tickRef.current = tick })

  const flushNow = useCallback(async () => {
    lastOpsAt.current = 0
    lastRevision.current = -1
    tickRef.current()
    await inflight.current
  }, [])

  useEffect(() => { session.liveFlush.current = flushNow }, [flushNow, session.liveFlush])

  const applyRemote = useCallback((ops: Ops) => {
    pendingRemote.current.push({ nodes: ops.nodes.map(canonicalNode), delNodes: ops.delNodes, edges: ops.edges.map(canonicalEdge), delEdges: ops.delEdges })
    session.remoteFlag.current = true
    session.setNodes((current) => {
      const map = new Map(current.map((node) => [node.id, node]))
      ops.delNodes.forEach((id) => map.delete(id))
      for (const api of ops.nodes) {
        const existing = map.get(api.id)
        if (existing?.dragging) continue
        const next = toFlowNodes([api])[0]
        map.set(api.id, existing ? { ...next, selected: existing.selected, measured: existing.measured } : next)
      }
      return sortParentsFirst([...map.values()])
    })
    session.setEdges((current) => {
      const map = new Map(current.map((edge) => [edge.id, edge]))
      ops.delEdges.forEach((id) => map.delete(id))
      for (const api of ops.edges) {
        const existing = map.get(api.id)
        map.set(api.id, { ...toFlowEdges([api])[0], selected: existing?.selected })
      }
      return [...map.values()]
    })
  }, [session])

  // Depois que o canvas renderiza a mudanca remota, ela passa a fazer parte do que o servidor ja sabe.
  useEffect(() => {
    if (!pendingRemote.current.length) return
    for (const ops of pendingRemote.current) session.serverGraph.current = applyOps(session.serverGraph.current, ops)
    pendingRemote.current = []
  }, [session.nodes, session.edges, session.serverGraph])

  const closeStream = useCallback(() => {
    source.current?.close()
    source.current = null
    window.clearTimeout(retryTimer.current)
    retryTimer.current = undefined
  }, [])

  const handle = useCallback((event: ServerEvent) => {
    switch (event.t) {
      case 'hello': {
        known.current = event.version
        failures.current = 0
        setMyColor(event.color)
        setPeers(event.roster)
        setChat(event.chat)
        setReadCount(event.chat.length)
        if (event.resync) { session.reload(); return }
        session.adoptVersion(event.version)
        if (event.role !== roleRef.current) session.applyRole(event.role)
        session.liveRef.current = true
        setStatus('live')
        outbox.current = { ...stateRef.current }
        return
      }
      case 'ops': {
        if (event.v <= known.current) return
        if (event.v !== known.current + 1) { session.reload(); return }
        known.current = event.v
        session.adoptVersion(event.v)
        if (event.from !== clientId.current) applyRemote(event.ops)
        return
      }
      case 'saved':
        session.setDirty(event.dirty)
        if (session.revision.current === lastRevision.current) session.setStatus('saved')
        return
      case 'join': setPeers((current) => [...current.filter((peer) => peer.id !== event.client.id), event.client]); return
      case 'leave':
        setPeers((current) => current.filter((peer) => peer.id !== event.id))
        if (followRef.current === event.id) setFollowId(null)
        return
      case 'state': {
        setPeers((current) => current.map((peer) => (peer.id === event.id ? { ...peer, ...event.patch } : peer)))
        if (event.id === followRef.current && event.patch.viewport) void setViewport(event.patch.viewport as Viewport, { duration: 120 })
        return
      }
      case 'react': {
        const color = peersRef.current.find((peer) => peer.id === event.id)?.color ?? '#868e96'
        const key = reactionKey.current++
        setReactions((current) => [...current, { key, emoji: event.emoji, x: event.x, y: event.y, color }])
        window.setTimeout(() => setReactions((current) => current.filter((item) => item.key !== key)), REACTION_MS)
        return
      }
      case 'chat': setChat((current) => [...current, event.message]); return
      case 'role': session.applyRole(event.role); return
      case 'kicked':
        kicked.current = true
        closeStream()
        session.liveRef.current = false
        setStatus('off')
        handlersRef.current.onKicked()
        return
      case 'resync': session.reload(); return
      case 'version': handlersRef.current.onVersion(event); return
      case 'comment': handlersRef.current.onComment(event.action, event.comment); return
      case 'notify': handlersRef.current.onNotify(event); return
    }
  }, [applyRemote, closeStream, session, setViewport])

  const connectRef = useRef<() => void>(() => {})

  const scheduleRetry = useCallback(() => {
    failures.current += 1
    const offline = failures.current >= MAX_FAILURES
    setStatus(offline ? 'offline' : 'connecting')
    session.liveRef.current = false
    const delay = offline ? OFFLINE_RETRY_MS : 1000 * 2 ** (failures.current - 1)
    window.clearTimeout(retryTimer.current)
    retryTimer.current = window.setTimeout(() => { retryTimer.current = undefined; connectRef.current() }, delay)
  }, [session])

  const connect = useCallback(() => {
    if (!boardId || !session.ready || source.current || kicked.current) return
    window.clearTimeout(retryTimer.current)
    retryTimer.current = undefined
    setStatus('connecting')
    const since = Number(session.getVersion())
    const query = `clientId=${clientId.current}${Number.isFinite(since) ? `&since=${since}` : ''}`
    const stream = new EventSource(`/api/boards/${boardId}/stream?${query}`)
    source.current = stream
    stream.onmessage = (message) => { handle(JSON.parse(message.data as string) as ServerEvent) }
    stream.onerror = () => {
      if (source.current !== stream) return
      closeStream()
      scheduleRetry()
    }
  }, [boardId, session, handle, closeStream, scheduleRetry])
  useEffect(() => { connectRef.current = connect }, [connect])

  const pause = useCallback(async () => {
    if (!source.current) return
    await flushNow()
    closeStream()
    session.liveRef.current = false
    session.markSynced()
    setPeers([])
    setStatus('paused')
  }, [closeStream, flushNow, session])

  // Ciclo de vida: abre ao interagir, fecha por inatividade (aba oculta ou sem uso).
  useEffect(() => {
    if (!boardId || !session.ready) return undefined
    kicked.current = false
    failures.current = 0
    lastActivity.current = Date.now()
    connect()

    const onActivity = () => {
      lastActivity.current = Date.now()
      if (!source.current && !kicked.current && !retryTimer.current) connectRef.current()
    }
    const onVisibility = () => {
      hiddenSince.current = document.hidden ? Date.now() : null
      if (!document.hidden) onActivity()
    }
    const onPageHide = () => { if (session.liveRef.current) tickRef.current(true) }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const
    events.forEach((name) => window.addEventListener(name, onActivity, { passive: true }))
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', onPageHide)

    const sender = window.setInterval(() => tickRef.current(), TICK_MS)
    const idle = window.setInterval(() => {
      const now = Date.now()
      const sleepy = now - lastActivity.current > IDLE_MS || (hiddenSince.current !== null && now - hiddenSince.current > HIDDEN_MS)
      if (sleepy && source.current) void pause()
    }, 10_000)

    return () => {
      events.forEach((name) => window.removeEventListener(name, onActivity))
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', onPageHide)
      window.clearInterval(sender)
      window.clearInterval(idle)
      closeStream()
      session.liveRef.current = false
      setPeers([])
      setStatus('off')
    }
    // connect/pause dependem de session (novo objeto a cada render): o ciclo so reinicia ao trocar de quadro ou recarregar.
  }, [boardId, session.ready])

  // Estado que o servidor precisa lembrar (e que reenviamos ao reconectar).
  const send = useCallback((patch: Partial<RemoteState>) => {
    stateRef.current = { ...stateRef.current, ...patch }
    outbox.current = { ...outbox.current, ...patch }
  }, [])

  const sendCursor = useCallback((position: { x: number; y: number } | null, laser = false) => {
    outbox.current = { ...outbox.current, cursor: position ? { ...position, laser } : null }
  }, [])

  const sendChat = useCallback((text: string) => { post({ chat: text }) }, [post])

  const sendReact = useCallback((emoji: string, x: number, y: number) => {
    post({ react: { emoji, x, y } })
    const key = reactionKey.current++
    setReactions((current) => [...current, { key, emoji, x, y, color: myColor }])
    window.setTimeout(() => setReactions((current) => current.filter((item) => item.key !== key)), REACTION_MS)
  }, [post, myColor])

  const setPresenting = useCallback((value: boolean) => { setPresentingState(value); send({ presenting: value }) }, [send])
  const sendSelection = useCallback((selection: string[]) => send({ selection }), [send])
  const sendEditing = useCallback((editing: RemoteState['editing']) => send({ editing }), [send])
  const sendHolding = useCallback((holding: string[]) => send({ holding }), [send])
  const sendViewport = useCallback((viewport: Viewport) => send({ viewport }), [send])
  const chatCount = chat.length
  const markChatRead = useCallback(() => setReadCount(chatCount), [chatCount])
  const wake = useCallback(() => { lastActivity.current = Date.now(); if (!source.current) connectRef.current() }, [])

  return {
    status, peers, chat, unread: Math.max(chatCount - readCount, 0), markChatRead,
    reactions, followId, setFollowId, myColor, clientId: clientId.current, presenting, setPresenting,
    sendCursor, sendSelection, sendEditing, sendHolding, sendViewport, sendChat, sendReact, flushNow, wake,
  }
}

export type Realtime = ReturnType<typeof useRealtime>
