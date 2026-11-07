import type { CommentItem, Severity } from '../types/realtime'
import type { ChangeRequest, ChangeWithProposal, Decision, UpdateResult } from '../types/review'
import type { AdminUser, AuditEntry, BoardChanges, BoardKind, BoardDetail, BoardMeta, BoardSummary, Branch, CommitSummary, CurrentUser, Graph, Presence, Shape, ShareList, ShareRole, Tag, TeamDetail, TeamRole, TeamSummary, UserHit } from '../types/board'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function api<T>(method: string, path: string, body?: unknown, keepalive = false): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive,
  })
  if (response.status === 401) {
    window.location.assign('/api/auth/login')
    throw new ApiError(401, 'não autenticado')
  }
  if (response.status === 204) return undefined as T
  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, payload.error ?? 'erro inesperado')
  return payload as T
}

export type UploadedPrint = { url: string; name: string }

export async function uploadPrint(file: File): Promise<UploadedPrint> {
  const response = await fetch('/api/process-prints', { method: 'POST', headers: { 'Content-Type': file.type }, body: file })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: string }
    throw new ApiError(response.status, payload.error ?? 'falha no envio da imagem')
  }
  return response.json() as Promise<UploadedPrint>
}

export const boardsApi = {
  me: () => api<CurrentUser>('GET', '/api/auth/me'),
  list: (archived = false) => api<BoardSummary[]>('GET', `/api/boards${archived ? '?archived=1' : ''}`),
  create: (name: string, kind: BoardKind = 'flowchart') => api<BoardMeta>('POST', '/api/boards', { name, kind }),
  get: (id: string) => api<BoardDetail>('GET', `/api/boards/${id}`),
  update: (id: string, changes: BoardChanges) => api<BoardMeta>('PATCH', `/api/boards/${id}`, changes),
  archive: (id: string) => api<void>('DELETE', `/api/boards/${id}`),
  remove: (id: string) => api<void>('DELETE', `/api/boards/${id}/permanent`),
  saveGraph: (id: string, graph: Graph & { rowVersion?: string }, keepalive = false) => api<BoardMeta>('PUT', `/api/boards/${id}/graph`, graph, keepalive),
  shapes: () => api<Shape[]>('GET', '/api/shapes'),
  suggestions: (from: string, limit = 5) => api<Shape[]>('GET', `/api/shapes/suggestions?from=${encodeURIComponent(from)}&limit=${limit}`),
  recordUsage: (from: string, to: string) => api<void>('POST', '/api/shapes/usage', { from, to }),
  commits: (id: string) => api<CommitSummary[]>('GET', `/api/boards/${id}/commits`),
  commitDetail: (id: string, commitId: string) => api<CommitSummary & { snapshot: Graph }>('GET', `/api/boards/${id}/commits/${commitId}`),
  commit: (id: string, message: string) => api<CommitSummary>('POST', `/api/boards/${id}/commits`, { message }),
  checkout: (id: string, target: { branchId?: string; commitId?: string; keepWorkingCopy?: boolean }) => api<{ headBranchId: string; baseCommitId: string }>('POST', `/api/boards/${id}/checkout`, target),
  branches: (id: string) => api<Branch[]>('GET', `/api/boards/${id}/branches`),
  createBranch: (id: string, name: string) => api<Branch>('POST', `/api/boards/${id}/branches`, { name }),
  tags: (id: string) => api<Tag[]>('GET', `/api/boards/${id}/tags`),
  createTag: (id: string, name: string, commitId?: string) => api<Tag>('POST', `/api/boards/${id}/tags`, { name, commitId }),
}

export const collabApi = {
  searchUsers: (term: string) => api<UserHit[]>('GET', `/api/users/search?q=${encodeURIComponent(term)}`),
  shares: (id: string) => api<ShareList>('GET', `/api/boards/${id}/shares`),
  share: (id: string, target: { unumber?: string; teamId?: string }, role: ShareRole) => api<ShareList>('POST', `/api/boards/${id}/shares`, { ...target, role }),
  setShareRole: (id: string, shareId: string, role: ShareRole) => api<void>('PATCH', `/api/boards/${id}/shares/${shareId}`, { role }),
  unshare: (id: string, shareId: string) => api<void>('DELETE', `/api/boards/${id}/shares/${shareId}`),
  transfer: (id: string, unumber: string) => api<{ ownerUnumber: string }>('POST', `/api/boards/${id}/transfer`, { unumber }),
  presence: (id: string) => api<Presence>('POST', `/api/boards/${id}/presence`, {}),
  teams: () => api<TeamSummary[]>('GET', '/api/teams'),
  createTeam: (name: string, description?: string) => api<{ id: string; name: string }>('POST', '/api/teams', { name, description }),
  team: (id: string) => api<TeamDetail>('GET', `/api/teams/${id}`),
  updateTeam: (id: string, changes: { name?: string; description?: string | null; archived?: boolean }) => api<void>('PATCH', `/api/teams/${id}`, changes),
  setMember: (id: string, unumber: string, role: TeamRole) => api<TeamDetail>('POST', `/api/teams/${id}/members`, { unumber, role }),
  removeMember: (id: string, unumber: string) => api<void>('DELETE', `/api/teams/${id}/members/${unumber}`),
  adminUsers: () => api<AdminUser[]>('GET', '/api/admin/users'),
  setUserActive: (unumber: string, active: boolean) => api<void>('PATCH', `/api/admin/users/${unumber}`, { active }),
  adminBoards: () => api<BoardSummary[]>('GET', '/api/admin/boards'),
  adminTeams: () => api<TeamSummary[]>('GET', '/api/admin/teams'),
  grantAdmin: (unumber: string) => api<void>('POST', '/api/admin/admins', { unumber }),
  revokeAdmin: (unumber: string) => api<void>('DELETE', `/api/admin/admins/${unumber}`),
  audit: () => api<AuditEntry[]>('GET', '/api/admin/audit'),
  online: () => api<OnlineRoom[]>('GET', '/api/admin/online'),
  comments: (id: string) => api<CommentItem[]>('GET', `/api/boards/${id}/comments`),
  addComment: (id: string, body: string, nodeId?: string | null, severity?: Severity | null) => api<CommentItem>('POST', `/api/boards/${id}/comments`, { body, nodeId: nodeId ?? null, severity: severity ?? null }),
  resolveComment: (id: string, commentId: string, resolved: boolean) => api<CommentItem>('PATCH', `/api/boards/${id}/comments/${commentId}`, { resolved }),
  deleteComment: (id: string, commentId: string) => api<void>('DELETE', `/api/boards/${id}/comments/${commentId}`),
}

export type OnlineRoom = { boardId: string; boardName: string; version: number; clients: { unumber: string; name: string; role: string; since: string }[] }

export const reviewApi = {
  setProtection: (id: string, protect: boolean, teamId?: string) => api<{ protected: boolean; reviewTeamId: string | null }>('PUT', `/api/boards/${id}/protection`, { protected: protect, teamId }),
  list: (id: string) => api<ChangeRequest[]>('GET', `/api/boards/${id}/changes`),
  ofFork: (id: string) => api<ChangeRequest | null>('GET', `/api/boards/${id}/change`),
  pending: (scope: 'review' | 'mine') => api<ChangeRequest[]>('GET', `/api/changes?scope=${scope}`),
  get: (requestId: string) => api<ChangeWithProposal>('GET', `/api/changes/${requestId}`),
  open: (id: string, body: { title: string; description?: string; assignee?: string }) => api<ChangeRequest>('POST', `/api/boards/${id}/changes`, body),
  submit: (requestId: string, body: { title?: string; description?: string } = {}) => api<ChangeRequest>('POST', `/api/changes/${requestId}/submit`, body),
  decide: (requestId: string, decision: Decision, comment?: string) => api<ChangeRequest>('POST', `/api/changes/${requestId}/decision`, { decision, comment }),
  update: (requestId: string) => api<UpdateResult>('POST', `/api/changes/${requestId}/update`, {}),
  cancel: (requestId: string) => api<ChangeRequest>('POST', `/api/changes/${requestId}/cancel`, {}),
}
