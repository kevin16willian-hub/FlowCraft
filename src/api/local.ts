import type { ApiEdge, ApiNode, BoardChanges, BoardDetail, BoardMeta, BoardSummary, Branch, CommitSummary, Graph, Shape, Tag } from '../types/board'
import type { CommentItem, Severity } from '../types/realtime'
import { ApiError } from './errors'

const STORAGE_KEY = 'flowcraft:local-api:v1'
const LOCAL_USER = { unumber: 'local-user', email: 'local@flowcraft.local', name: 'Usuário local' }

type StoredCommit = CommitSummary & { snapshot: Graph }
type StoredBoard = BoardMeta & {
  nodes: ApiNode[]
  edges: ApiEdge[]
  dirty: boolean
  commits: StoredCommit[]
  branches: Branch[]
  tags: Tag[]
  comments: CommentItem[]
}
type LocalState = { boards: StoredBoard[]; prints: Record<string, string> }

const SHAPES: Shape[] = [
  { key: 'rectangle', label: 'Retângulo', type: 'shape', width: 160, height: 80, style: null },
  { key: 'square', label: 'Quadrado', type: 'shape', width: 100, height: 100, style: null },
  { key: 'circle', label: 'Círculo', type: 'shape', width: 100, height: 100, style: null },
  { key: 'ellipse', label: 'Elipse', type: 'shape', width: 140, height: 80, style: null },
  { key: 'right_triangle', label: 'Triângulo', type: 'shape', width: 100, height: 100, style: null },
  { key: 'stage', label: 'Etapa', type: 'stage', width: 220, height: 90, style: null },
  { key: 'gateway', label: 'Condicional', type: 'gateway', width: 90, height: 90, style: null },
  { key: 'start', label: 'Início', type: 'start', width: 70, height: 70, style: null },
  { key: 'end', label: 'Fim', type: 'end', width: 70, height: 70, style: null },
  { key: 'pool', label: 'Pool', type: 'area', width: 760, height: 360, style: null },
  { key: 'lane', label: 'Lane', type: 'area', width: 760, height: 140, style: null },
  { key: 'phase', label: 'Phase', type: 'area', width: 380, height: 300, style: null },
  { key: 'text', label: 'Texto', type: 'text', width: 160, height: 40, style: null },
  { key: 'note', label: 'Nota', type: 'note', width: 160, height: 120, style: null },
]

const now = () => new Date().toISOString()
const id = () => crypto.randomUUID()
const clone = <T,>(value: T): T => structuredClone(value)

function readState(): LocalState {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return { boards: [], prints: {} }
  try {
    const state: unknown = JSON.parse(raw)
    if (typeof state === 'object' && state !== null && 'boards' in state && Array.isArray(state.boards) && 'prints' in state && typeof state.prints === 'object' && state.prints !== null) {
      return state as LocalState
    }
    throw new Error('formato de armazenamento inválido')
  } catch (error) {
    throw new ApiError(500, `Não foi possível ler os dados locais: ${error instanceof Error ? error.message : 'JSON inválido'}`)
  }
}

function writeState(state: LocalState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch (error) {
    if (error instanceof DOMException && (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
      throw new ApiError(507, 'Armazenamento local cheio. Remova alguns prints ou exporte seus quadros antes de continuar.')
    }
    throw error
  }
}

const boardById = (state: LocalState, boardId: string) => {
  const board = state.boards.find((item) => item.id === boardId)
  if (!board) throw new ApiError(404, 'quadro não encontrado')
  return board
}

const metaOf = (board: StoredBoard): BoardMeta => {
  const { nodes: _nodes, edges: _edges, dirty: _dirty, commits: _commits, branches: _branches, tags: _tags, comments: _comments, ...meta } = board
  return clone(meta)
}

const graphOf = (state: LocalState, board: StoredBoard): Graph => ({
  nodes: clone(board.nodes).map((node) => ({
    ...node,
    attachments: node.attachments.map((attachment) => ({
      ...attachment,
      url: state.prints[attachment.name] ?? attachment.url,
    })),
  })),
  edges: clone(board.edges),
})

const summaryOf = (board: StoredBoard): BoardSummary => ({
  id: board.id,
  name: board.name,
  description: board.description,
  archived: board.archived,
  nodeCount: board.nodes.length,
  createdAt: board.createdAt,
  updatedAt: board.updatedAt,
  ownerUnumber: board.ownerUnumber,
  ownerName: LOCAL_USER.name,
  role: 'owner',
})

function snapshotOf(board: StoredBoard): Graph {
  return { nodes: clone(board.nodes), edges: clone(board.edges) }
}

function isDirty(board: StoredBoard) {
  const base = board.commits.find((commit) => commit.id === board.baseCommitId)?.snapshot
  return !base || JSON.stringify(base) !== JSON.stringify(snapshotOf(board))
}

function getBoard(state: LocalState, boardId: string): BoardDetail {
  const board = boardById(state, boardId)
  return { ...metaOf(board), ...graphOf(state, board), dirty: isDirty(board) }
}

function updated(board: StoredBoard) {
  board.updatedAt = now()
  board.rowVersion = String(Number(board.rowVersion) + 1)
}

function graphFromBody(body: unknown): Graph {
  if (typeof body !== 'object' || body === null || !('nodes' in body) || !Array.isArray(body.nodes) || !('edges' in body) || !Array.isArray(body.edges)) {
    throw new ApiError(400, 'grafo inválido')
  }
  return { nodes: clone(body.nodes) as ApiNode[], edges: clone(body.edges) as ApiEdge[] }
}

function createCommit(board: StoredBoard, message: string): StoredCommit {
  const cleanMessage = message.trim()
  if (!cleanMessage || cleanMessage.length > 500) throw new ApiError(400, 'Informe uma mensagem de até 500 caracteres.')
  const activeBranch = board.branches.find((branch) => branch.id === board.headBranchId)
  if (!activeBranch) throw new ApiError(409, 'quadro sem branch ativo')
  const parentId = activeBranch.headCommitId
  const snapshot = snapshotOf(board)
  const parent = board.commits.find((commit) => commit.id === parentId)
  if (parent && JSON.stringify(parent.snapshot) === JSON.stringify(snapshot)) throw new ApiError(409, 'nada para commitar')
  const commit: StoredCommit = {
    id: id(), seq: board.commits.length + 1, parentId, author: LOCAL_USER.unumber, message: cleanMessage,
    nodeCount: snapshot.nodes.length, edgeCount: snapshot.edges.length, autosave: false, createdAt: now(), snapshot,
  }
  board.commits.push(commit)
  const branch = board.branches.find((item) => item.id === board.headBranchId)
  if (branch) branch.headCommitId = commit.id
  board.baseCommitId = commit.id
  updated(board)
  return commit
}

export async function localApiRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = new URL(path, window.location.origin)
  const route = url.pathname
  const state = readState()
  let result: unknown
  let changed = false

  if (method === 'GET' && route === '/api/auth/me') {
    result = LOCAL_USER
  } else if (method === 'GET' && route === '/api/shapes') {
    result = SHAPES
  } else if (method === 'GET' && route === '/api/shapes/suggestions') {
    const from = url.searchParams.get('from') ?? '*'
    const defaults: Record<string, string[]> = { '*': ['stage', 'gateway', 'end'], start: ['stage'], stage: ['stage', 'gateway', 'end'], gateway: ['stage', 'end'], end: ['stage'] }
    const keys = [...(defaults[from] ?? []), ...(defaults['*'] ?? [])]
    result = [...new Set(keys)].slice(0, Math.min(Number(url.searchParams.get('limit')) || 5, 12)).map((key) => SHAPES.find((shape) => shape.key === key)).filter(Boolean)
  } else if (method === 'POST' && route === '/api/shapes/usage') {
    result = undefined
  } else if (route === '/api/boards' && method === 'GET') {
    const archived = url.searchParams.get('archived') === '1'
    result = state.boards.filter((board) => board.archived === archived).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(summaryOf)
  } else if (route === '/api/boards' && method === 'POST') {
    const input = body as { name?: unknown; kind?: unknown } | undefined
    if (typeof input?.name !== 'string' || !input.name.trim() || input.name.trim().length > 200) throw new ApiError(400, 'nome obrigatório (até 200 caracteres)')
    if (input.kind !== undefined && input.kind !== 'flowchart' && input.kind !== 'aws') throw new ApiError(400, 'tipo de quadro inválido')
    const timestamp = now()
    const boardId = id()
    const branchId = id()
    const initial: StoredCommit = {
      id: id(), seq: 1, parentId: null, author: LOCAL_USER.unumber, message: 'Quadro criado',
      nodeCount: 0, edgeCount: 0, autosave: false, createdAt: timestamp, snapshot: { nodes: [], edges: [] },
    }
    const board: StoredBoard = {
      id: boardId, name: input.name.trim(), description: null, headBranchId: branchId, baseCommitId: initial.id,
      viewport: null, settings: input.kind === 'aws' ? { kind: 'aws' } : null, archived: false,
      createdAt: timestamp, updatedAt: timestamp, rowVersion: '1', role: 'owner', ownerUnumber: LOCAL_USER.unumber,
      protected: false, reviewTeamId: null, nodes: [], edges: [], dirty: false,
      commits: [initial], branches: [{ id: branchId, name: 'main', headCommitId: initial.id, createdBy: LOCAL_USER.unumber, createdAt: timestamp }],
      tags: [], comments: [],
    }
    state.boards.push(board)
    result = metaOf(board)
    changed = true
  } else {
    const match = route.match(/^\/api\/boards\/([^/]+)(?:\/(.*))?$/)
    if (!match) throw new ApiError(501, 'Este recurso não está disponível no modo local.')
    const [, boardId, resource = ''] = match
    const board = boardById(state, boardId)

    if (!resource && method === 'GET') result = getBoard(state, boardId)
    else if (!resource && method === 'PATCH') {
      const changes = body as BoardChanges
      if (changes.name !== undefined) {
        if (!changes.name.trim() || changes.name.trim().length > 200) throw new ApiError(400, 'nome obrigatório (até 200 caracteres)')
        board.name = changes.name.trim()
      }
      if ('description' in changes) board.description = changes.description ?? null
      if ('viewport' in changes) board.viewport = changes.viewport ?? null
      if ('settings' in changes) board.settings = changes.settings ?? null
      if ('archived' in changes) board.archived = changes.archived === true
      updated(board)
      result = metaOf(board)
      changed = true
    } else if (!resource && method === 'DELETE') {
      board.archived = true
      updated(board)
      changed = true
    } else if (resource === 'permanent' && method === 'DELETE') {
      state.boards = state.boards.filter((item) => item.id !== boardId)
      changed = true
    } else if (resource === 'graph' && method === 'PUT') {
      const incomingVersion = (body as { rowVersion?: string } | undefined)?.rowVersion
      if (incomingVersion && incomingVersion !== board.rowVersion) throw new ApiError(409, 'quadro alterado em outra sessão')
      const graph = graphFromBody(body)
      board.nodes = graph.nodes.map((node) => ({ ...node, attachments: node.attachments.map(({ name }) => ({ name })) }))
      board.edges = graph.edges
      updated(board)
      result = { ...metaOf(board), dirty: isDirty(board) }
      changed = true
    } else if (resource === 'commits' && method === 'GET') {
      result = [...board.commits].sort((a, b) => b.seq - a.seq).map(({ snapshot: _snapshot, ...commit }) => commit)
    } else if (resource === 'commits' && method === 'POST') {
      const commit = createCommit(board, (body as { message?: string }).message ?? '')
      const { snapshot: _snapshot, ...summary } = commit
      result = summary
      changed = true
    } else if (resource === 'branches' && method === 'GET') {
      result = board.branches
    } else if (resource === 'branches' && method === 'POST') {
      const input = body as { name?: string; commitId?: string }
      const name = input.name?.trim()
      if (!name || name.length > 100 || !/^\w[\w ./-]*$/.test(name)) throw new ApiError(400, 'nome de branch inválido')
      if (board.branches.some((branch) => branch.name === name)) throw new ApiError(409, 'branch já existe')
      const sourceCommit = input.commitId ?? board.baseCommitId
      if (!board.commits.some((commit) => commit.id === sourceCommit)) throw new ApiError(404, 'commit não encontrado')
      const branch: Branch = { id: id(), name, headCommitId: sourceCommit, createdBy: LOCAL_USER.unumber, createdAt: now() }
      board.branches.push(branch)
      result = branch
      changed = true
    } else if (resource === 'checkout' && method === 'POST') {
      const target = body as { branchId?: string; commitId?: string; keepWorkingCopy?: boolean }
      const branch = target.branchId ? board.branches.find((item) => item.id === target.branchId) : undefined
      const commitId = branch?.headCommitId ?? target.commitId
      const commit = board.commits.find((item) => item.id === commitId)
      if (!commit) throw new ApiError(404, 'commit não encontrado')
      const currentBranchId = board.headBranchId
      if (!currentBranchId) throw new ApiError(409, 'quadro sem branch ativo')
      if (!target.keepWorkingCopy) {
        board.nodes = clone(commit.snapshot.nodes)
        board.edges = clone(commit.snapshot.edges)
        updated(board)
      }
      board.headBranchId = branch?.id ?? currentBranchId
      board.baseCommitId = commit.id
      result = { headBranchId: board.headBranchId, baseCommitId: board.baseCommitId }
      changed = true
    } else if (resource === 'tags' && method === 'GET') {
      result = board.tags
    } else if (resource === 'tags' && method === 'POST') {
      const input = body as { name?: string; commitId?: string }
      const name = input.name?.trim()
      const commitId = input.commitId ?? board.baseCommitId
      if (!name || name.length > 100 || !commitId || !board.commits.some((commit) => commit.id === commitId)) throw new ApiError(400, 'tag ou commit inválido')
      if (board.tags.some((tag) => tag.name === name)) throw new ApiError(409, 'tag já existe')
      const tag: Tag = { id: id(), name, commitId, message: null, createdBy: LOCAL_USER.unumber, createdAt: now() }
      board.tags.push(tag)
      result = tag
      changed = true
    } else if (resource === 'comments' && method === 'GET') {
      result = board.comments
    } else if (resource === 'comments' && method === 'POST') {
      const input = body as { body?: string; nodeId?: string | null; severity?: Severity | null }
      if (!input.body?.trim()) throw new ApiError(400, 'comentário obrigatório')
      const comment: CommentItem = {
        id: id(), nodeId: input.nodeId ?? null, parentId: null,
        author: { unumber: LOCAL_USER.unumber, name: LOCAL_USER.name }, body: input.body.trim(),
        mentions: [], resolved: false, severity: input.severity ?? null, createdAt: now(),
      }
      board.comments.push(comment)
      result = comment
      changed = true
    } else {
      const commitMatch = resource.match(/^commits\/([^/]+)$/)
      const commentMatch = resource.match(/^comments\/([^/]+)$/)
      if (commitMatch && method === 'GET') {
        const commit = board.commits.find((item) => item.id === commitMatch[1])
        if (!commit) throw new ApiError(404, 'commit não encontrado')
        result = commit
      } else if (commentMatch && method === 'PATCH') {
        const comment = board.comments.find((item) => item.id === commentMatch[1])
        if (!comment) throw new ApiError(404, 'comentário não encontrado')
        comment.resolved = (body as { resolved?: boolean }).resolved === true
        result = comment
        changed = true
      } else if (commentMatch && method === 'DELETE') {
        board.comments = board.comments.filter((item) => item.id !== commentMatch[1] && item.parentId !== commentMatch[1])
        changed = true
      } else {
        throw new ApiError(501, 'Este recurso não está disponível no modo local.')
      }
    }
  }

  if (changed) writeState(state)
  return clone(result) as T
}

export async function storeLocalPrint(file: File) {
  const extensions: Record<string, string> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }
  const extension = extensions[file.type]
  if (!extension) throw new ApiError(415, 'tipo de imagem não suportado')
  if (file.size > 1024 * 1024) throw new ApiError(413, 'a imagem deve ter no máximo 1 MB')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('falha ao ler a imagem'))
    reader.onerror = () => reject(reader.error ?? new Error('falha ao ler a imagem'))
    reader.readAsDataURL(file)
  })
  const state = readState()
  const name = `print-${id()}${extension}`
  state.prints[name] = dataUrl
  writeState(state)
  return { url: dataUrl, name }
}
