export type NodeType = 'start' | 'end' | 'stage' | 'gateway' | 'area' | 'text' | 'shape' | 'note'

export type ApiAttachment = { name: string; url?: string }

export type ApiNode = {
  id: string
  type: NodeType
  shapeKey: string | null
  parentId: string | null
  x: number
  y: number
  width: number | null
  height: number | null
  rotation: number
  zIndex: number
  title: string | null
  description: string | null
  inputs: string | null
  outputs: string | null
  style: Record<string, unknown> | null
  data: Record<string, unknown> | null
  locked: boolean
  attachments: ApiAttachment[]
}

export type ApiEdge = {
  id: string
  source: string
  target: string
  sourceHandle: string | null
  targetHandle: string | null
  type: string | null
  label: string | null
  branch: 'true' | 'false' | null
  style: Record<string, unknown> | null
  data: Record<string, unknown> | null
}

export type Graph = { nodes: ApiNode[]; edges: ApiEdge[] }

export type Viewport = { x: number; y: number; zoom: number }
export type BoardKind = 'flowchart' | 'aws'
export type BoardSettings = { background?: string; kind?: BoardKind }

export type Role = 'viewer' | 'editor' | 'owner'

export type BoardSummary = {
  id: string
  name: string
  description: string | null
  archived: boolean
  nodeCount: number
  createdAt: string
  updatedAt: string
  ownerUnumber: string
  ownerName: string | null
  role: Role | null
}

export type BoardMeta = {
  id: string
  name: string
  description: string | null
  headBranchId: string | null
  baseCommitId: string | null
  viewport: Viewport | null
  settings: BoardSettings | null
  archived: boolean
  createdAt: string
  updatedAt: string
  rowVersion: string
  role: Role
  ownerUnumber: string
  protected: boolean
  reviewTeamId: string | null
  canReview?: boolean
  dirty?: boolean
}

export type BoardDetail = BoardMeta & Graph & { dirty: boolean }

export type CommitSummary = {
  id: string
  seq: number
  parentId: string | null
  author: string
  message: string
  nodeCount: number
  edgeCount: number
  autosave: boolean
  createdAt: string
}

export type Branch = { id: string; name: string; headCommitId: string | null; createdBy: string; createdAt: string }
export type Tag = { id: string; name: string; commitId: string; message: string | null; createdBy: string; createdAt: string }

export type BoardChanges = Partial<{ name: string; description: string | null; viewport: Viewport | null; settings: BoardSettings | null; archived: boolean }>

export type Shape = { key: string; label: string; type: NodeType; width: number; height: number; style: Record<string, unknown> | null }

export type CurrentUser = { unumber: string; email: string; name?: string; isAdmin?: boolean }

export type ShareRole = 'viewer' | 'editor'
export type UserHit = { unumber: string; name: string | null; email: string; pending: boolean }
export type Share =
  | { id: string; type: 'user'; unumber: string; name: string | null; pending: boolean; role: ShareRole; grantedAt: string }
  | { id: string; type: 'team'; teamId: string; name: string; role: ShareRole; grantedAt: string }
export type ShareList = { owner: { unumber: string; name: string | null }; shares: Share[] }

export type TeamRole = 'member' | 'team_admin'
export type TeamSummary = { id: string; name: string; description: string | null; role: TeamRole; memberCount: number; boardCount: number }
export type TeamDetail = {
  id: string
  name: string
  description: string | null
  role: TeamRole
  members: { unumber: string; name: string | null; role: TeamRole; pending: boolean }[]
  boards: { id: string; name: string; updatedAt: string; ownerUnumber: string; ownerName: string | null; role: ShareRole }[]
}

export type AdminUser = { unumber: string; name: string | null; email: string; active: boolean; lastLoginAt: string | null; boardCount: number; teamCount: number; admin: boolean }
export type AuditEntry = { id: number; actor: string; action: string; boardId: string | null; teamId: string | null; target: string | null; detail: string | null; at: string }
export type Presence = { users: { unumber: string; name: string; role: Role }[]; graphVersion: string }
