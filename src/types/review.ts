import type { Graph } from './board'

export type ChangeStatus = 'draft' | 'open' | 'changes_requested' | 'merged' | 'rejected' | 'cancelled'
export type Decision = 'approve' | 'request_changes' | 'reject'

export type ChangeRequest = {
  id: string
  boardId: string
  boardName: string
  forkBoardId: string
  title: string
  description: string | null
  status: ChangeStatus
  author: { unumber: string; name: string | null }
  baseCommitId: string
  outdated: boolean
  isAuthor: boolean
  canDecide: boolean
  decidedBy: string | null
  decisionComment: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ChangeWithProposal = ChangeRequest & { proposed: Graph | null }
export type UpdateResult = { updated: boolean; upToDate: boolean; conflicts: { id: string; title: string }[] }
