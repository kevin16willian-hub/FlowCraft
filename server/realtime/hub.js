import { saveLiveGraph } from '../db/boards.js'
import { readGraph } from '../db/graph.js'
import { roleFor } from '../db/access.js'
import { query, sql } from '../db/pool.js'
import { sanitizeGraph } from '../utils/graph-schema.js'
import { httpError, log } from '../utils/http.js'

// Tempo real por SSE (servidor -> cliente) + POST (cliente -> servidor). Estado em memoria; instancia unica do pm2.
const PERSIST_DELAY_MS = 1500
const HEARTBEAT_MS = 15_000
const HOLD_TTL_MS = 20_000
const LOG_SIZE = 500
const CHAT_SIZE = 100
const MAX_CLIENTS = 50
const MAX_MESSAGES_PER_SECOND = 60
const COLORS = ['#e03131', '#1971c2', '#2f9e44', '#f08c00', '#9c36b5', '#0c8599', '#d6336c', '#5c940d', '#e8590c', '#3b5bdb']
const EMOJIS = new Set(['👍', '❤️', '🎉', '👀', '😂', '🤔'])
const RANK = { viewer: 1, editor: 2, owner: 3 }

const rooms = new Map()
const byUser = new Map()

const publicState = (client) => ({ id: client.id, unumber: client.user.unumber, name: client.user.name, role: client.role, color: client.color, since: client.since, ...client.state })

// Entrada/saida de elementos no formato da API (anexos com url, sem campos internos).
const wireNode = (node) => {
  const { depth: _depth, ...rest } = node
  return { ...rest, attachments: node.attachments.map((attachment) => ({ name: attachment.name, url: `/api/process-prints/${attachment.name}` })) }
}

const write = (client, payload) => {
  if (client.res.writableEnded || client.res.destroyed) return
  client.res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

const broadcast = (room, payload, exceptId) => {
  for (const client of room.clients.values()) if (client.id !== exceptId) write(client, payload)
}

const loadRoom = async (boardId, board) => {
  const graph = sanitizeGraph(await readGraph(boardId))
  return {
    boardId,
    name: board.name,
    nodes: new Map(graph.nodes.map((node) => [node.id, node])),
    edges: new Map(graph.edges.map((edge) => [edge.id, edge])),
    version: Number(board.graph_version),
    persistedVersion: Number(board.graph_version),
    clients: new Map(),
    log: [],
    chat: [],
    timer: null,
    persisting: null,
    lastEditor: board.owner_unumber,
    protected: board.is_protected === true,
  }
}

const getRoom = (boardId, board) => {
  let entry = rooms.get(boardId)
  if (!entry) {
    entry = loadRoom(boardId, board).then((room) => { rooms.set(boardId, room); return room })
    rooms.set(boardId, entry)
    entry.catch(() => rooms.delete(boardId))
  }
  return Promise.resolve(entry)
}

const snapshot = (room) => ({ nodes: [...room.nodes.values()], edges: [...room.edges.values()] })

const persist = async (room) => {
  clearTimeout(room.timer)
  room.timer = null
  if (room.persisting) return room.persisting
  if (room.version === room.persistedVersion) return undefined
  const version = room.version
  room.persisting = (async () => {
    try {
      const dirty = await saveLiveGraph(room.lastEditor, room.boardId, snapshot(room), version)
      room.persistedVersion = version
      broadcast(room, { t: 'saved', v: version, dirty })
    } catch (error) {
      log('rt_persist_failed', { boardId: room.boardId, message: error.message })
      room.timer = setTimeout(() => { void persist(room) }, 5000)
    } finally {
      room.persisting = null
    }
    if (room.version !== room.persistedVersion && !room.timer) room.timer = setTimeout(() => { void persist(room) }, PERSIST_DELAY_MS)
  })()
  return room.persisting
}

const schedulePersist = (room) => { room.timer ??= setTimeout(() => { void persist(room) }, PERSIST_DELAY_MS) }

export const isLive = (boardId) => {
  const room = rooms.get(boardId)
  return !!room && !(room instanceof Promise) && room.clients.size > 0
}

// Grava na hora o que estiver pendente (antes de commits, leituras e desligamento).
export const flush = async (boardId) => {
  const room = await rooms.get(boardId)
  if (room) await persist(room)
}

export const flushAll = async () => { await Promise.all([...rooms.keys()].map((boardId) => flush(boardId).catch(() => {}))) }

// Aplica um lote de operacoes: valida o grafo resultante inteiro e so entao adota (tudo ou nada).
const applyOps = (room, client, ops) => {
  const heldByOthers = new Set()
  const now = Date.now()
  for (const other of room.clients.values()) {
    if (other.id !== client.id && now - other.lastMessage < HOLD_TTL_MS) for (const id of other.state.holding) heldByOthers.add(id)
  }
  const nodes = new Map(room.nodes)
  const edges = new Map(room.edges)
  const touchedNodes = []
  const touchedEdges = []
  const removedNodes = []
  const removedEdges = []

  for (const node of Array.isArray(ops.nodes) ? ops.nodes : []) {
    if (!node || heldByOthers.has(node.id)) continue
    nodes.set(node.id, node)
    touchedNodes.push(node.id)
  }
  for (const id of Array.isArray(ops.delNodes) ? ops.delNodes : []) {
    if (heldByOthers.has(id) || !nodes.has(id)) continue
    nodes.delete(id)
    removedNodes.push(id)
  }
  for (const edge of Array.isArray(ops.edges) ? ops.edges : []) {
    if (!edge) continue
    edges.set(edge.id, edge)
    touchedEdges.push(edge.id)
  }
  for (const id of Array.isArray(ops.delEdges) ? ops.delEdges : []) {
    if (edges.delete(id)) removedEdges.push(id)
  }
  if (!touchedNodes.length && !removedNodes.length && !touchedEdges.length && !removedEdges.length) return null

  // Remover um no leva junto os filhos e as setas ligadas a ele (mesma regra do canvas).
  for (let changed = true; changed;) {
    changed = false
    for (const [id, node] of nodes) {
      if (node?.parentId && !nodes.has(node.parentId)) { nodes.delete(id); removedNodes.push(id); changed = true }
    }
  }
  for (const [id, edge] of edges) {
    if (!nodes.has(edge?.source) || !nodes.has(edge?.target)) { edges.delete(id); removedEdges.push(id) }
  }

  const graph = sanitizeGraph({ nodes: [...nodes.values()], edges: [...edges.values()] })
  const nextNodes = new Map(graph.nodes.map((node) => [node.id, node]))
  const nextEdges = new Map(graph.edges.map((edge) => [edge.id, edge]))

  room.nodes = nextNodes
  room.edges = nextEdges
  room.version += 1
  room.lastEditor = client.user.unumber
  schedulePersist(room)

  const entry = {
    v: room.version,
    from: client.id,
    ops: {
      nodes: touchedNodes.filter((id) => nextNodes.has(id)).map((id) => wireNode(nextNodes.get(id))),
      delNodes: removedNodes.concat(touchedNodes.filter((id) => !nextNodes.has(id))),
      edges: touchedEdges.filter((id) => nextEdges.has(id)).map((id) => nextEdges.get(id)),
      delEdges: removedEdges,
    },
  }
  room.log.push(entry)
  if (room.log.length > LOG_SIZE) room.log.shift()
  return entry
}

const finite = (value) => typeof value === 'number' && Number.isFinite(value)
const ids = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && /^[\w.:-]{1,64}$/.test(item)).slice(0, 50) : [])

export const handleMessage = (room, client, message) => {
  const now = Date.now()
  client.window = client.window.filter((time) => now - time < 1000)
  if (client.window.length >= MAX_MESSAGES_PER_SECOND) throw httpError(429, 'muitas mensagens')
  client.window.push(now)
  client.lastMessage = now
  const canEdit = RANK[client.role] >= RANK.editor && !room.protected
  const patch = {}

  if (message.cursor !== undefined) patch.cursor = message.cursor && finite(message.cursor.x) && finite(message.cursor.y) ? { x: message.cursor.x, y: message.cursor.y, laser: message.cursor.laser === true } : null
  if (message.selection !== undefined) patch.selection = ids(message.selection)
  if (message.editing !== undefined) patch.editing = message.editing && typeof message.editing.nodeId === 'string' ? { nodeId: message.editing.nodeId.slice(0, 64), field: String(message.editing.field ?? '').slice(0, 20) } : null
  if (message.holding !== undefined && canEdit) patch.holding = ids(message.holding)
  if (message.viewport !== undefined && message.viewport && finite(message.viewport.x) && finite(message.viewport.y) && finite(message.viewport.zoom)) patch.viewport = { x: message.viewport.x, y: message.viewport.y, zoom: message.viewport.zoom }
  if (message.presenting !== undefined && canEdit) patch.presenting = message.presenting === true
  if (Object.keys(patch).length) {
    Object.assign(client.state, patch)
    broadcast(room, { t: 'state', id: client.id, patch }, client.id)
  }

  if (message.react && EMOJIS.has(message.react.emoji) && finite(message.react.x) && finite(message.react.y)) {
    broadcast(room, { t: 'react', id: client.id, emoji: message.react.emoji, x: message.react.x, y: message.react.y }, client.id)
  }
  if (typeof message.chat === 'string' && message.chat.trim()) {
    const entry = { id: `${now}-${client.id}`, from: { unumber: client.user.unumber, name: client.user.name, color: client.color }, text: message.chat.trim().slice(0, 500), at: new Date(now).toISOString() }
    room.chat.push(entry)
    if (room.chat.length > CHAT_SIZE) room.chat.shift()
    broadcast(room, { t: 'chat', message: entry })
  }

  if (message.ops) {
    if (!canEdit) throw httpError(403, 'permissao insuficiente')
    const entry = applyOps(room, client, message.ops)
    if (entry) broadcast(room, { t: 'ops', ...entry })
  }
}

export const joinRoom = async ({ boardId, board, user, role, clientId, since, response }) => {
  const room = await getRoom(boardId, board)
  if (room.clients.size >= MAX_CLIENTS) throw httpError(503, 'quadro lotado')
  const used = new Set([...room.clients.values()].map((entry) => entry.color))
  const client = {
    id: clientId, user, role, res: response, color: COLORS.find((color) => !used.has(color)) ?? COLORS[room.clients.size % COLORS.length],
    since: new Date().toISOString(), lastMessage: Date.now(), window: [],
    state: { cursor: null, selection: [], editing: null, holding: [], viewport: null, presenting: false },
  }
  room.clients.get(clientId)?.res.end()
  room.clients.set(clientId, client)
  if (!byUser.has(user.unumber)) byUser.set(user.unumber, new Set())
  byUser.get(user.unumber).add(client)

  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  response.socket?.setNoDelay(true)
  response.socket?.setTimeout(0)

  const oldest = room.log[0]?.v ?? room.version + 1
  const resync = since !== undefined && (since > room.version || (since < room.version && oldest > since + 1))
  write(client, {
    t: 'hello', clientId, role, color: client.color, version: room.version, resync,
    roster: [...room.clients.values()].filter((entry) => entry.id !== clientId).map(publicState), chat: room.chat,
  })
  if (since !== undefined && !resync) for (const entry of room.log) if (entry.v > since) write(client, { t: 'ops', ...entry })
  broadcast(room, { t: 'join', client: publicState(client) }, clientId)

  const heartbeat = setInterval(() => { if (!response.writableEnded) response.write(': ping\n\n') }, HEARTBEAT_MS)
  response.on('close', () => {
    clearInterval(heartbeat)
    if (room.clients.get(clientId) === client) room.clients.delete(clientId)
    byUser.get(user.unumber)?.delete(client)
    broadcast(room, { t: 'leave', id: clientId })
    if (room.clients.size === 0) {
      void persist(room).finally(() => { if (room.clients.size === 0 && rooms.get(boardId) === room) rooms.delete(boardId) })
    }
  })
  return room
}

export const getJoinedRoom = async (boardId, clientId) => {
  const room = await rooms.get(boardId)
  const client = room?.clients.get(clientId)
  return room && client ? { room, client } : null
}

export const broadcastBoard = async (boardId, payload) => {
  const room = rooms.get(boardId)
  if (room && !(room instanceof Promise)) broadcast(room, payload)
}

// Restauracao de versao: descarta o estado em memoria e manda todos recarregarem.
export const resetRoom = async (boardId) => {
  const room = await rooms.get(boardId)
  if (!room) return
  clearTimeout(room.timer)
  room.timer = null
  const { recordset } = await query('SELECT * FROM flowcraft.boards WHERE board_id = @boardId', { boardId: [sql.UniqueIdentifier, boardId] })
  const fresh = await loadRoom(boardId, recordset[0])
  Object.assign(room, { nodes: fresh.nodes, edges: fresh.edges, version: fresh.version, persistedVersion: fresh.version, log: [], protected: fresh.protected })
  broadcast(room, { t: 'resync' })
}

export const notifyUser = (unumber, payload) => {
  for (const client of byUser.get(unumber) ?? []) write(client, { t: 'notify', ...payload })
}

// Recalcula o papel de quem esta conectado depois de mudancas de compartilhamento, time ou propriedade.
export const refreshAccess = async (boardId) => {
  const targets = boardId ? [await rooms.get(boardId)] : await Promise.all(rooms.values())
  for (const room of targets.filter(Boolean)) {
    const { recordset } = await query('SELECT * FROM flowcraft.boards WHERE board_id = @boardId', { boardId: [sql.UniqueIdentifier, room.boardId] })
    for (const client of room.clients.values()) {
      const role = recordset[0] ? await roleFor(client.user.unumber, recordset[0]) : null
      if (!role) {
        write(client, { t: 'kicked' })
        client.res.end()
      } else if (role !== client.role) {
        client.role = role
        write(client, { t: 'role', role })
        broadcast(room, { t: 'state', id: client.id, patch: { role } }, client.id)
      }
    }
  }
}

export const listOnline = async () => {
  const resolved = await Promise.all(rooms.values())
  return resolved.filter((room) => room.clients.size).map((room) => ({
    boardId: room.boardId, boardName: room.name, version: room.version,
    clients: [...room.clients.values()].map((client) => ({ unumber: client.user.unumber, name: client.user.name, role: client.role, since: client.since })),
  }))
}
