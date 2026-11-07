import { useCallback, useEffect, useState } from 'react'
import { boardsApi } from '../api/client'
import type { Branch, CommitSummary, Tag } from '../types/board'
import type { useBoardSession } from './useBoardSession'

type Session = ReturnType<typeof useBoardSession>

// Historico estilo git: commits (snapshots), branches e tags do quadro aberto.
export function useVersioning(session: Session) {
  const boardId = session.meta?.id ?? null
  const baseCommitId = session.meta?.baseCommitId ?? null
  const headBranchId = session.meta?.headBranchId ?? null
  const [commits, setCommits] = useState<CommitSummary[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [tags, setTags] = useState<Tag[]>([])

  const refresh = useCallback(async () => {
    if (!boardId) return
    const [nextCommits, nextBranches, nextTags] = await Promise.all([boardsApi.commits(boardId), boardsApi.branches(boardId), boardsApi.tags(boardId)])
    setCommits(nextCommits)
    setBranches(nextBranches)
    setTags(nextTags)
  }, [boardId])

  useEffect(() => { void refresh().catch(() => {}) }, [refresh, baseCommitId, headBranchId])

  const requireBoard = () => { if (!boardId) throw new Error('nenhum quadro aberto'); return boardId }

  const commit = async (message: string) => {
    const id = requireBoard()
    await session.flush()
    await boardsApi.commit(id, message)
    await session.refreshMeta()
    await refresh()
  }

  const restoreCommit = async (commitId: string) => {
    const id = requireBoard()
    await session.flush()
    await boardsApi.checkout(id, { commitId })
    session.reload()
  }

  const switchBranch = async (branchId: string) => {
    const id = requireBoard()
    await session.flush()
    await boardsApi.checkout(id, { branchId })
    session.reload()
  }

  // Cria o branch a partir da versao atual e passa a usa-lo, mantendo as alteracoes em andamento.
  const createBranch = async (name: string) => {
    const id = requireBoard()
    await session.flush()
    const branch = await boardsApi.createBranch(id, name)
    await boardsApi.checkout(id, { branchId: branch.id, keepWorkingCopy: true })
    await session.refreshMeta()
    await refresh()
  }

  const createTag = async (name: string, commitId?: string) => {
    await boardsApi.createTag(requireBoard(), name, commitId)
    await refresh()
  }

  return {
    commits, branches, tags, baseCommitId, headBranchId, refresh,
    currentBranch: branches.find((branch) => branch.id === headBranchId) ?? null,
    commit, restoreCommit, switchBranch, createBranch, createTag,
  }
}
