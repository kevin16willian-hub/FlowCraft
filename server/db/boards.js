import { createHash } from 'node:crypto'
import { httpError } from '../utils/http.js'
import { sanitizeGraph } from '../utils/graph-schema.js'
import { readGraph, replaceGraph } from './graph.js'
import { assertRole, audit, isAdmin, isReviewer, roleFor } from './access.js'
import { query, sql, transaction } from './pool.js'

const uuid = (value) => [sql.UniqueIdentifier, value]
const unumberParam = (value) => [sql.VarChar(20), value]

const toBoard = (row) => ({
  id: row.board_id,
  name: row.name,
  description: row.description,
  headBranchId: row.head_branch_id,
  baseCommitId: row.base_commit_id,
  viewport: row.viewport_json ? JSON.parse(row.viewport_json) : null,
  settings: row.settings_json ? JSON.parse(row.settings_json) : null,
  archived: row.is_archived,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  rowVersion: String(row.graph_version),
  role: row.role,
  ownerUnumber: row.owner_unumber,
  protected: row.is_protected === true,
  reviewTeamId: row.review_team_id ?? null,
})

// Todo acesso a um quadro passa por aqui: resolve o papel efetivo (dono, admin, compartilhamento) e exige o minimo.
export const findBoard = async (unumber, boardId, executor, { lock = false, min = 'viewer', allowProtected = false } = {}) => {
  const hint = lock ? 'WITH (UPDLOCK, ROWLOCK)' : ''
  const { recordset } = await query(`SELECT * FROM flowcraft.boards ${hint} WHERE board_id = @boardId`, { boardId: uuid(boardId) }, executor)
  const row = recordset[0]
  if (!row) throw httpError(404, 'quadro nao encontrado')
  const role = await roleFor(unumber, row, executor)
  assertRole(role, min)
  if (min === 'editor' && row.is_protected && !allowProtected) throw httpError(403, 'quadro protegido: proponha uma mudanca para revisao')
  return { ...row, role }
}

// scope: accessible (padrao: meus + compartilhados), mine, shared ou all (so admin global).
export const listBoards = async (unumber, { archived = false, scope = 'accessible' } = {}) => {
  if (scope === 'all' && !await isAdmin(unumber)) throw httpError(403, 'permissao insuficiente')
  const { recordset } = await query(
    `SELECT b.board_id, b.name, b.description, b.is_archived, b.created_at, b.updated_at, b.owner_unumber, u.display_name AS owner_name,
       (SELECT COUNT(*) FROM flowcraft.nodes n WHERE n.board_id = b.board_id) AS node_count,
       CASE WHEN b.owner_unumber = @unumber THEN 3 ELSE ISNULL(sr.rank, 0) END AS rank
     FROM flowcraft.boards b
     JOIN flowcraft.users u ON u.unumber = b.owner_unumber
     OUTER APPLY (SELECT MAX(CASE s.role WHEN 'editor' THEN 2 ELSE 1 END) AS rank FROM flowcraft.board_shares s
                  WHERE s.board_id = b.board_id
                    AND (s.user_unumber = @unumber OR s.team_id IN (SELECT team_id FROM flowcraft.team_members WHERE unumber = @unumber))) sr
     WHERE b.is_archived = @archived
     ORDER BY b.updated_at DESC`,
    { unumber: unumberParam(unumber), archived: [sql.Bit, archived] },
  )
  const names = [null, 'viewer', 'editor', 'owner']
  return recordset
    .filter((row) => (scope === 'all' ? true
      : scope === 'mine' ? row.owner_unumber === unumber
      : scope === 'shared' ? row.owner_unumber !== unumber && row.rank > 0
      : row.rank > 0))
    .map((row) => ({
      id: row.board_id, name: row.name, description: row.description, archived: row.is_archived,
      nodeCount: row.node_count, createdAt: row.created_at, updatedAt: row.updated_at,
      ownerUnumber: row.owner_unumber, ownerName: row.owner_name, role: names[row.rank] ?? null,
    }))
}

export const hashSnapshot = (graph) => createHash('sha256').update(JSON.stringify(graph)).digest('hex')

// Cria quadro + branch "main" + commit inicial vazio.
export const createBoard = (unumber, { name, description, settings }) => transaction(async (tx) => {
  const created = await query(
    `INSERT INTO flowcraft.boards (owner_unumber, name, description, settings_json) OUTPUT inserted.board_id
     VALUES (@unumber, @name, @description, @settings)`,
    { unumber: unumberParam(unumber), name: [sql.NVarChar(200), name], description: [sql.NVarChar(1000), description ?? null], settings: [sql.NVarChar(sql.MAX), settings ? JSON.stringify(settings) : null] }, tx,
  )
  const boardId = created.recordset[0].board_id
  const empty = { version: 1, nodes: [], edges: [] }

  const commit = await query(
    `INSERT INTO flowcraft.commits (board_id, parent_commit_id, author_unumber, message, snapshot_json, snapshot_hash)
     OUTPUT inserted.commit_id VALUES (@boardId, NULL, @unumber, N'Quadro criado', @snapshot, @hash)`,
    { boardId: uuid(boardId), unumber: unumberParam(unumber), snapshot: [sql.NVarChar(sql.MAX), JSON.stringify(empty)], hash: [sql.Char(64), hashSnapshot(empty)] }, tx,
  )
  const commitId = commit.recordset[0].commit_id

  const branch = await query(
    `INSERT INTO flowcraft.branches (board_id, name, head_commit_id, created_by) OUTPUT inserted.branch_id
     VALUES (@boardId, N'main', @commitId, @unumber)`,
    { boardId: uuid(boardId), commitId: uuid(commitId), unumber: unumberParam(unumber) }, tx,
  )

  await query(
    'UPDATE flowcraft.boards SET head_branch_id = @branchId, base_commit_id = @commitId WHERE board_id = @boardId',
    { boardId: uuid(boardId), branchId: uuid(branch.recordset[0].branch_id), commitId: uuid(commitId) }, tx,
  )
  return toBoard(await findBoard(unumber, boardId, tx))
})

// Alteracoes nao commitadas: compara o hash da working copy com o do commit base.
export const isDirty = async (baseCommitId, graph, executor) => {
  if (!baseCommitId) return true
  const { recordset } = await query('SELECT snapshot_hash FROM flowcraft.commits WHERE commit_id = @id', { id: uuid(baseCommitId) }, executor)
  return !recordset[0] || recordset[0].snapshot_hash !== hashSnapshot({ version: 1, ...graph })
}

// Quadro + working copy + indicador de alteracoes nao commitadas.
export const getBoardWithGraph = async (unumber, boardId) => {
  const row = await findBoard(unumber, boardId)
  const graph = await readGraph(boardId)
  return { ...toBoard(row), ...graph, dirty: await isDirty(row.base_commit_id, graph), canReview: row.is_protected === true && await isReviewer(unumber, row) }
}

export const updateBoard = async (unumber, boardId, changes) => {
  await findBoard(unumber, boardId, undefined, { min: changes.archived !== undefined ? 'owner' : 'editor', allowProtected: true })
  const sets = []
  const params = { boardId: uuid(boardId) }
  if (changes.name !== undefined) { sets.push('name = @name'); params.name = [sql.NVarChar(200), changes.name] }
  if (changes.description !== undefined) { sets.push('description = @description'); params.description = [sql.NVarChar(1000), changes.description] }
  if (changes.viewport !== undefined) { sets.push('viewport_json = @viewport'); params.viewport = [sql.NVarChar(sql.MAX), changes.viewport && JSON.stringify(changes.viewport)] }
  if (changes.settings !== undefined) { sets.push('settings_json = @settings'); params.settings = [sql.NVarChar(sql.MAX), changes.settings && JSON.stringify(changes.settings)] }
  if (changes.archived !== undefined) { sets.push('is_archived = @archived'); params.archived = [sql.Bit, changes.archived] }
  if (!sets.length) throw httpError(400, 'nada para atualizar')
  await query(`UPDATE flowcraft.boards SET ${sets.join(', ')}, updated_at = SYSUTCDATETIME() WHERE board_id = @boardId`, params)
  return toBoard(await findBoard(unumber, boardId))
}

// Exclusao definitiva (so o dono): commits, branches, comentarios e compartilhamentos saem em cascata.
export const deleteBoard = (unumber, boardId) => transaction(async (tx) => {
  const row = await findBoard(unumber, boardId, tx, { lock: true, min: 'owner', allowProtected: true })
  const pending = await query(
    "SELECT 1 AS ok FROM flowcraft.change_requests WHERE fork_board_id = @boardId AND status IN ('draft', 'open', 'changes_requested')",
    { boardId: uuid(boardId) }, tx,
  )
  if (pending.recordset.length) throw httpError(409, 'este quadro e uma proposta de mudanca em andamento; cancele a proposta antes de excluir')
  await query('DELETE FROM flowcraft.boards WHERE board_id = @boardId', { boardId: uuid(boardId) }, tx)
  await audit(unumber, 'board_deleted', { boardId, target: row.name }, tx)
})

// Autosave da working copy. rowVersion (opcional) evita sobrescrever alteracoes mais novas.
export const saveGraph = (unumber, boardId, body) => transaction(async (tx) => {
  const graph = sanitizeGraph(body)
  const row = await findBoard(unumber, boardId, tx, { lock: true, min: 'editor' })
  if (body.rowVersion && String(row.graph_version) !== body.rowVersion) throw httpError(409, 'quadro alterado em outra sessao')
  await replaceGraph(tx, boardId, graph, unumber)
  await query(
    'UPDATE flowcraft.boards SET updated_at = SYSUTCDATETIME(), graph_version = graph_version + 1 WHERE board_id = @boardId',
    { boardId: uuid(boardId) }, tx,
  )
  return { ...toBoard(await findBoard(unumber, boardId, tx)), dirty: await isDirty(row.base_commit_id, await readGraph(boardId, tx), tx) }
})

// Persistencia da sala ao vivo: grava a working copy e fixa a versao do grafo em version.
export const saveLiveGraph = (unumber, boardId, graph, version) => transaction(async (tx) => {
  const row = (await query('SELECT base_commit_id FROM flowcraft.boards WITH (UPDLOCK, ROWLOCK) WHERE board_id = @boardId', { boardId: uuid(boardId) }, tx)).recordset[0]
  if (!row) throw httpError(404, 'quadro nao encontrado')
  await replaceGraph(tx, boardId, graph, unumber)
  await query(
    'UPDATE flowcraft.boards SET updated_at = SYSUTCDATETIME(), graph_version = @version WHERE board_id = @boardId',
    { boardId: uuid(boardId), version: [sql.BigInt, version] }, tx,
  )
  return isDirty(row.base_commit_id, await readGraph(boardId, tx), tx)
})
