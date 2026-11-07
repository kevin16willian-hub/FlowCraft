import type { ApiEdge, ApiNode, Role, Viewport } from './board'

export type Ops = { nodes: ApiNode[]; delNodes: string[]; edges: ApiEdge[]; delEdges: string[] }

export type RemoteState = {
  cursor: { x: number; y: number; laser: boolean } | null
  selection: string[]
  editing: { nodeId: string; field: string } | null
  holding: string[]
  viewport: Viewport | null
  presenting: boolean
}

export type Peer = RemoteState & { id: string; unumber: string; name: string; role: Role; color: string; since: string }

export type ChatMessage = { id: string; from: { unumber: string; name: string; color: string }; text: string; at: string }

export type CommentItem = {
  id: string
  nodeId: string | null
  parentId: string | null
  author: { unumber: string; name: string | null }
  body: string
  mentions: string[]
  resolved: boolean
  severity: Severity | null
  createdAt: string
}

export type Severity = 'issue' | 'warning' | 'ok'

export type LiveStatus = 'off' | 'connecting' | 'live' | 'paused' | 'offline'

export type Notice = { id: number; text: string; tone?: 'info' | 'warn' }

export type Reaction = { key: number; emoji: string; x: number; y: number; color: string }

export type ServerEvent =
  | { t: 'hello'; clientId: string; role: Role; color: string; version: number; resync: boolean; roster: Peer[]; chat: ChatMessage[] }
  | { t: 'ops'; v: number; from: string; ops: Ops }
  | { t: 'join'; client: Peer }
  | { t: 'leave'; id: string }
  | { t: 'state'; id: string; patch: Partial<RemoteState> & { role?: Role } }
  | { t: 'react'; id: string; emoji: string; x: number; y: number }
  | { t: 'chat'; message: ChatMessage }
  | { t: 'saved'; v: number; dirty: boolean }
  | { t: 'version'; kind: string; by: string; message?: string }
  | { t: 'role'; role: Role }
  | { t: 'kicked' }
  | { t: 'resync' }
  | { t: 'comment'; action: 'add' | 'update' | 'delete'; comment: CommentItem }
  | { t: 'notify'; kind: 'shared' | 'mention' | 'team' | 'review'; boardId?: string; boardName?: string; teamId?: string; by: string; role?: string; text?: string }
