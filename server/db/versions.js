import { httpError } from '../utils/http.js'
import { sanitizeGraph } from '../utils/graph-schema.js'
import { findBoard, hashSnapshot } from './boards.js'
import { readGraph, replaceGraph } from './graph.js'
import { query, sql, transaction } from './pool.js'

const uuid = (value) => [sql.UniqueIdentifier, value]
const unumberParam = (value) => [sql.VarChar(20), value]

const toCommit = (row) => ({
  id: row.commit_id,
  seq: Number(row.commit_seq),
  parentId: row.parent_commit_id,
  author: row.author_unumber,
  message: row.message,
  nodeCount: row.node_count,
  edgeCount: row.edge_count,
  autosave: row.is_autosave,
  hash: row.snapshot_hash,
  createdAt: row.created_at,
})

const findCommit = async (boardId, commitId, executor) => {
  const { recordset } = await query(
    'SELECT * FROM flowcraft.commits WHERE board_id = @boardId AND commit_id = @commitId',
    { boardId: uuid(boardId), commitId: uuid(commitId) }, executor,
  )
  if (!recordset[0]) throw httpError(404, 'commit nao encontrado')
  return recordset[0]
}

const refName = (value) => {
  if (typeof value !== 'string' || !/^\w[\w ./-]{0,99}$/.test(value.trim())) throw httpError(400, 'nome invalido')
  return value.trim()
}

export const listCommits = async (unumber, boardId, limit = 100) => {
  await findBoard(unumber, boardId)
  const { recordset } = await query(
    `SELECT TOP (@limit) commit_id, commit_seq, parent_commit_id, author_unumber, message, node_count, edge_count,
       is_autosave, snapshot_hash, created_at
     FROM flowcraft.commits WHERE board_id = @boardId ORDER BY commit_seq DESC`,
    { boardId: uuid(boardId), limit: [sql.Int, Math.min(Math.max(limit, 1), 500)] },
  )
  return recordset.map(toCommit)
}

export const getCommit = async (unumber, boardId, commitId) => {
  await findBoard(unumber, boardId)
  const row = await findCommit(boardId, commitId)
  return { ...toCommit(row), snapshot: JSON.parse(row.snapshot_json) }
}

// Snapshot da working copy no branch atual. 409 quando nada mudou desde o ultimo commit do branch.
export const createCommit = (unumber, boardId, { message, autosave = false }) => transaction(async (tx) => {
  if (typeof message !== 'string' || !message.trim() || message.length > 500) throw httpError(400, 'mensagem obrigatoria (ate 500 caracteres)')
  const board = await findBoard(unumber, boardId, tx, { lock: true, min: 'editor' })
  if (!board.head_branch_id) throw httpError(409, 'quadro sem branch ativo')

  const branch = (await query('SELECT head_commit_id FROM flowcraft.branches WHERE board_id = @boardId AND branch_id = @branchId',
    { boardId: uuid(boardId), branchId: uuid(board.head_branch_id) }, tx)).recordset[0]
  const parent = branch.head_commit_id ? await findCommit(boardId, branch.head_commit_id, tx) : null

  const graph = await readGraph(boardId, tx)
  const snapshot = { version: 1, ...graph }
  const hash = hashSnapshot(snapshot)
  if (parent?.snapshot_hash === hash) throw httpError(409, 'nada para commitar')

  return insertCommit(tx, boardId, board.head_branch_id, parent, unumber, message.trim(), graph, autosave === true)
})

// Grava o commit, avanca o branch e fixa a working copy como base.
export const insertCommit = async (tx, boardId, branchId, parent, unumber, message, graph, autosave = false) => {
  const snapshot = { version: 1, ...graph }
  const hash = hashSnapshot(snapshot)
  const created = await query(
    `INSERT INTO flowcraft.commits (board_id, parent_commit_id, author_unumber, message, snapshot_json, snapshot_hash,
       node_count, edge_count, is_autosave)
     OUTPUT inserted.commit_id
     VALUES (@boardId, @parent, @unumber, @message, @snapshot, @hash, @nodes, @edges, @autosave)`,
    {
      boardId: uuid(boardId), parent: uuid(parent?.commit_id ?? null), unumber: unumberParam(unumber),
      message: [sql.NVarChar(500), message], snapshot: [sql.NVarChar(sql.MAX), JSON.stringify(snapshot)],
      hash: [sql.Char(64), hash], nodes: [sql.Int, graph.nodes.length], edges: [sql.Int, graph.edges.length],
      autosave: [sql.Bit, autosave],
    }, tx,
  )
  const commitId = created.recordset[0].commit_id
  await query('UPDATE flowcraft.branches SET head_commit_id = @commitId WHERE board_id = @boardId AND branch_id = @branchId',
    { boardId: uuid(boardId), branchId: uuid(branchId), commitId: uuid(commitId) }, tx)
  await query('UPDATE flowcraft.boards SET base_commit_id = @commitId, updated_at = SYSUTCDATETIME() WHERE board_id = @boardId',
    { boardId: uuid(boardId), commitId: uuid(commitId) }, tx)
  return toCommit(await findCommit(boardId, commitId, tx))
}

// Troca de branch (branchId) ou restauracao de um commit na working copy do branch atual (commitId).
export const checkout = (unumber, boardId, { branchId, commitId, keepWorkingCopy = false }) => transaction(async (tx) => {
  const board = await findBoard(unumber, boardId, tx, { lock: true, min: 'editor' })
  let targetCommitId = commitId
  let targetBranchId = board.head_branch_id

  if (branchId) {
    const branch = (await query('SELECT branch_id, head_commit_id FROM flowcraft.branches WHERE board_id = @boardId AND branch_id = @branchId',
      { boardId: uuid(boardId), branchId: uuid(branchId) }, tx)).recordset[0]
    if (!branch?.head_commit_id) throw httpError(404, 'branch nao encontrado')
    targetBranchId = branch.branch_id
    targetCommitId = branch.head_commit_id
  }
  if (!targetCommitId) throw httpError(400, 'informe branchId ou commitId')

  const commit = await findCommit(boardId, targetCommitId, tx)
  if (!keepWorkingCopy) await replaceGraph(tx, boardId, sanitizeGraph(JSON.parse(commit.snapshot_json)), unumber)
  await query(
    `UPDATE flowcraft.boards SET head_branch_id = @branchId, base_commit_id = @commitId, updated_at = SYSUTCDATETIME()${keepWorkingCopy ? '' : ', graph_version = graph_version + 1'}
     WHERE board_id = @boardId`,
    { boardId: uuid(boardId), branchId: uuid(targetBranchId), commitId: uuid(commit.commit_id) }, tx,
  )
  return { headBranchId: targetBranchId, baseCommitId: commit.commit_id }
})

export const listBranches = async (unumber, boardId) => {
  await findBoard(unumber, boardId)
  const { recordset } = await query(
    'SELECT branch_id, name, head_commit_id, created_by, created_at FROM flowcraft.branches WHERE board_id = @boardId ORDER BY name',
    { boardId: uuid(boardId) },
  )
  return recordset.map((row) => ({ id: row.branch_id, name: row.name, headCommitId: row.head_commit_id, createdBy: row.created_by, createdAt: row.created_at }))
}

// Novo branch aponta para o commit informado (padrao: commit base atual). Nao troca o branch ativo.
export const createBranch = async (unumber, boardId, { name, commitId }) => {
  const board = await findBoard(unumber, boardId, undefined, { min: 'editor', allowProtected: true })
  const from = commitId ?? board.base_commit_id
  if (!from) throw httpError(400, 'commit de origem indefinido')
  await findCommit(boardId, from)
  const branchLabel = refName(name)
  const { recordset } = await query(
    `INSERT INTO flowcraft.branches (board_id, name, head_commit_id, created_by) OUTPUT inserted.branch_id
     VALUES (@boardId, @name, @commitId, @unumber)`,
    { boardId: uuid(boardId), name: [sql.NVarChar(100), branchLabel], commitId: uuid(from), unumber: unumberParam(unumber) },
  )
  return { id: recordset[0].branch_id, name: branchLabel, headCommitId: from }
}

export const listTags = async (unumber, boardId) => {
  await findBoard(unumber, boardId)
  const { recordset } = await query(
    'SELECT tag_id, name, commit_id, message, created_by, created_at FROM flowcraft.tags WHERE board_id = @boardId ORDER BY created_at DESC',
    { boardId: uuid(boardId) },
  )
  return recordset.map((row) => ({ id: row.tag_id, name: row.name, commitId: row.commit_id, message: row.message, createdBy: row.created_by, createdAt: row.created_at }))
}

export const createTag = async (unumber, boardId, { name, commitId, message }) => {
  const board = await findBoard(unumber, boardId, undefined, { min: 'editor', allowProtected: true })
  const target = commitId ?? board.base_commit_id
  if (!target) throw httpError(400, 'commit indefinido')
  await findCommit(boardId, target)
  const tagLabel = refName(name)
  const { recordset } = await query(
    `INSERT INTO flowcraft.tags (board_id, name, commit_id, message, created_by) OUTPUT inserted.tag_id
     VALUES (@boardId, @name, @commitId, @message, @unumber)`,
    {
      boardId: uuid(boardId), name: [sql.NVarChar(100), tagLabel], commitId: uuid(target),
      message: [sql.NVarChar(500), message ?? null], unumber: unumberParam(unumber),
    },
  )
  return { id: recordset[0].tag_id, name: tagLabel, commitId: target }
}
