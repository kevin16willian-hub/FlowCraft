import { httpError } from '../utils/http.js'
import { sanitizeGraph } from '../utils/graph-schema.js'
import { mergeGraphs } from '../utils/graph-merge.js'
import { audit, isReviewer, roleFor } from './access.js'
import { createBoard, findBoard, hashSnapshot, isDirty } from './boards.js'
import { readGraph, replaceGraph } from './graph.js'
import { query, sql, transaction } from './pool.js'
import { insertCommit } from './versions.js'

const uuid = (value) => [sql.UniqueIdentifier, value]
const unumberParam = (value) => [sql.VarChar(20), value]

const OPEN_FOR_EDIT = ['draft', 'changes_requested']
const DECISIONS = { approve: 'merged', request_changes: 'changes_requested', reject: 'rejected' }

const SELECT = `SELECT r.*, a.display_name AS author_name FROM flowcraft.change_requests r
  JOIN flowcraft.users a ON a.unumber = r.author_unumber`

const rawBoard = async (boardId, executor) => {
  const { recordset } = await query('SELECT * FROM flowcraft.boards WHERE board_id = @boardId', { boardId: uuid(boardId) }, executor)
  if (!recordset[0]) throw httpError(404, 'quadro nao encontrado')
  return recordset[0]
}

const headCommit = async (board, executor) => {
  const { recordset } = await query(
    `SELECT c.commit_id, c.snapshot_json, c.snapshot_hash FROM flowcraft.branches b
     JOIN flowcraft.commits c ON c.commit_id = b.head_commit_id
     WHERE b.board_id = @boardId AND b.branch_id = @branchId`,
    { boardId: uuid(board.board_id), branchId: uuid(board.head_branch_id) }, executor,
  )
  if (!recordset[0]) throw httpError(409, 'quadro sem versao registrada')
  return recordset[0]
}

export const reviewersOf = async (board, except) => {
  if (!board.review_team_id) return []
  const { recordset } = await query('SELECT unumber FROM flowcraft.team_members WHERE team_id = @teamId', { teamId: uuid(board.review_team_id) })
  return recordset.map((row) => row.unumber).filter((unumber) => unumber !== except)
}

const describe = async (row, unumber, board, executor) => {
  const head = board.head_branch_id ? await headCommit(board, executor).catch(() => null) : null
  return {
    id: row.request_id,
    boardId: row.board_id,
    boardName: board.name,
    forkBoardId: row.fork_board_id,
    title: row.title,
    description: row.description,
    status: row.status,
    author: { unumber: row.author_unumber, name: row.author_name },
    openedBy: row.opened_by,
    baseCommitId: row.base_commit_id,
    outdated: !!head && head.commit_id.toLowerCase() !== row.base_commit_id.toLowerCase(),
    isAuthor: row.author_unumber === unumber,
    canDecide: row.status === 'open' && row.author_unumber !== unumber && await isReviewer(unumber, board, executor),
    decidedBy: row.decided_by,
    decisionComment: row.decision_comment,
    decidedAt: row.decided_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const loadChange = async (unumber, requestId, executor) => {
  const { recordset } = await query(`${SELECT} WHERE r.request_id = @requestId`, { requestId: uuid(requestId) }, executor)
  const row = recordset[0]
  if (!row) throw httpError(404, 'proposta nao encontrada')
  const board = await rawBoard(row.board_id, executor)
  let visible = await roleFor(unumber, board, executor)
  if (!visible) visible = await roleFor(unumber, await rawBoard(row.fork_board_id, executor), executor)
  if (!visible) throw httpError(404, 'proposta nao encontrada')
  return { row, board }
}

const requireAuthor = (row, unumber) => { if (row.author_unumber !== unumber) throw httpError(403, 'so o autor da proposta pode fazer isso') }

const shareWithTeam = (boardId, teamId, grantedBy, executor) => query(
  `IF NOT EXISTS (SELECT 1 FROM flowcraft.board_shares WHERE board_id = @boardId AND team_id = @teamId)
     INSERT INTO flowcraft.board_shares (board_id, team_id, role, granted_by) VALUES (@boardId, @teamId, 'viewer', @grantedBy)`,
  { boardId: uuid(boardId), teamId: uuid(teamId), grantedBy: unumberParam(grantedBy) }, executor,
)

const bumpVersion = (boardId, executor) => query('UPDATE flowcraft.boards SET graph_version = graph_version + 1, updated_at = SYSUTCDATETIME() WHERE board_id = @boardId',
  { boardId: uuid(boardId) }, executor)

const text = (value, max, field, { required = false } = {}) => {
  const clean = typeof value === 'string' ? value.trim() : ''
  if (required && !clean) throw httpError(400, `${field} obrigatorio`)
  if (clean.length > max) throw httpError(400, `${field} muito longo (ate ${max} caracteres)`)
  return clean || null
}

export const setProtection = async (unumber, boardId, { protect, teamId }) => {
  const board = await findBoard(unumber, boardId, undefined, { min: 'owner', allowProtected: true })
  if (protect) {
    if (!teamId) throw httpError(400, 'escolha o time revisor')
    const team = (await query('SELECT 1 AS ok FROM flowcraft.teams WHERE team_id = @teamId AND is_archived = 0', { teamId: uuid(teamId) })).recordset
    if (!team.length) throw httpError(404, 'time nao encontrado')
    if (!board.is_protected && await isDirty(board.base_commit_id, await readGraph(boardId))) throw httpError(409, 'registre uma versao (commit) antes de proteger o quadro')
  }
  await query('UPDATE flowcraft.boards SET is_protected = @protect, review_team_id = @teamId, updated_at = SYSUTCDATETIME() WHERE board_id = @boardId',
    { boardId: uuid(boardId), protect: [sql.Bit, protect === true], teamId: uuid(protect ? teamId : null) })
  if (protect) await shareWithTeam(boardId, teamId, unumber)
  await audit(unumber, protect ? 'board_protect' : 'board_unprotect', { boardId, teamId: protect ? teamId : null })
  return { protected: protect === true, reviewTeamId: protect ? teamId : null }
}

// Cria a copia de trabalho (a partir do ultimo commit do quadro protegido) e a proposta.
export const openChange = async (unumber, boardId, { title, description, assignee }) => {
  const board = await findBoard(unumber, boardId)
  if (!board.is_protected) throw httpError(400, 'o quadro nao esta protegido')
  const name = text(title, 200, 'titulo', { required: true })
  const note = text(description, 2000, 'descricao')
  let author = unumber
  if (assignee && String(assignee).toUpperCase() !== unumber) {
    if (!(board.role === 'owner' || await isReviewer(unumber, board))) throw httpError(403, 'so revisores podem abrir mudanca para outra pessoa')
    author = String(assignee).toUpperCase()
    const found = await query('SELECT 1 AS ok FROM flowcraft.users WHERE unumber = @unumber AND is_active = 1', { unumber: unumberParam(author) })
    if (!found.recordset.length) throw httpError(404, 'pessoa nao encontrada')
  }

  const head = await headCommit(board)
  const graph = sanitizeGraph(JSON.parse(head.snapshot_json))
  const fork = await createBoard(author, { name: `${board.name} · ${name}`.slice(0, 200), description: `Proposta de mudança em "${board.name}"`, settings: board.settings_json ? { kind: JSON.parse(board.settings_json).kind } : null })
  const requestId = await transaction(async (tx) => {
    await replaceGraph(tx, fork.id, graph, author)
    await bumpVersion(fork.id, tx)
    if (board.review_team_id) await shareWithTeam(fork.id, board.review_team_id, author, tx)
    const created = await query(
      `INSERT INTO flowcraft.change_requests (board_id, fork_board_id, base_commit_id, title, description, author_unumber, opened_by)
       OUTPUT inserted.request_id VALUES (@boardId, @forkId, @baseId, @title, @description, @author, @openedBy)`,
      {
        boardId: uuid(boardId), forkId: uuid(fork.id), baseId: uuid(head.commit_id), title: [sql.NVarChar(200), name],
        description: [sql.NVarChar(2000), note], author: unumberParam(author), openedBy: unumberParam(unumber),
      }, tx,
    )
    return created.recordset[0].request_id
  })
  await audit(unumber, 'change_open', { boardId, target: requestId, detail: name })
  return getChange(unumber, requestId)
}

export const getChange = async (unumber, requestId, { withProposal = false } = {}) => {
  const { row, board } = await loadChange(unumber, requestId)
  const change = await describe(row, unumber, board)
  return withProposal ? { ...change, proposed: row.proposed_json ? JSON.parse(row.proposed_json) : null } : change
}

export const listChanges = async (unumber, boardId) => {
  const board = await findBoard(unumber, boardId)
  const { recordset } = await query(`${SELECT} WHERE r.board_id = @boardId ORDER BY r.updated_at DESC`, { boardId: uuid(boardId) })
  return Promise.all(recordset.map((row) => describe(row, unumber, board)))
}

// A proposta cuja copia de trabalho e este quadro (ou null).
export const changeOfFork = async (unumber, forkBoardId) => {
  await findBoard(unumber, forkBoardId)
  const { recordset } = await query(`${SELECT} WHERE r.fork_board_id = @forkId`, { forkId: uuid(forkBoardId) })
  if (!recordset[0]) return null
  return describe(recordset[0], unumber, await rawBoard(recordset[0].board_id))
}

// scope review: propostas abertas que posso decidir; mine: as minhas ainda em andamento.
export const pendingChanges = async (unumber, scope) => {
  const sqlText = scope === 'review'
    ? `${SELECT} JOIN flowcraft.boards b ON b.board_id = r.board_id
       WHERE r.status = 'open' AND r.author_unumber <> @unumber
         AND (b.review_team_id IN (SELECT team_id FROM flowcraft.team_members WHERE unumber = @unumber)
              OR EXISTS (SELECT 1 FROM flowcraft.admins WHERE unumber = @unumber))
       ORDER BY r.updated_at`
    : `${SELECT} WHERE r.author_unumber = @unumber AND r.status IN ('draft', 'changes_requested', 'open') ORDER BY r.updated_at DESC`
  const { recordset } = await query(sqlText, { unumber: unumberParam(unumber) })
  return Promise.all(recordset.map(async (row) => describe(row, unumber, await rawBoard(row.board_id))))
}

const submitInTx = (unumber, requestId, { title, description }) => transaction(async (tx) => {
  const { row, board } = await loadChange(unumber, requestId, tx)
  requireAuthor(row, unumber)
  if (!OPEN_FOR_EDIT.includes(row.status)) throw httpError(409, 'a proposta nao pode ser enviada neste estado')
  const graph = sanitizeGraph(await readGraph(row.fork_board_id, tx))
  const proposed = { version: 1, ...graph }
  const base = (await query('SELECT snapshot_hash FROM flowcraft.commits WHERE commit_id = @id', { id: uuid(row.base_commit_id) }, tx)).recordset[0]
  if (base?.snapshot_hash === hashSnapshot(proposed)) throw httpError(409, 'nenhuma alteracao em relacao ao quadro original')
  await query(
    `UPDATE flowcraft.change_requests SET status = 'open', proposed_json = @proposed, title = ISNULL(@title, title), description = ISNULL(@description, description),
       decided_by = NULL, decision_comment = NULL, decided_at = NULL, updated_at = SYSUTCDATETIME() WHERE request_id = @requestId`,
    {
      requestId: uuid(requestId), proposed: [sql.NVarChar(sql.MAX), JSON.stringify(proposed)],
      title: [sql.NVarChar(200), text(title, 200, 'titulo')], description: [sql.NVarChar(2000), text(description, 2000, 'descricao')],
    }, tx,
  )
  await audit(unumber, 'change_submit', { boardId: row.board_id, target: requestId }, tx)
  return { board }
})

export const submitChange = async (unumber, requestId, body) => {
  const { board } = await submitInTx(unumber, requestId, body)
  return { change: await getChange(unumber, requestId), reviewers: await reviewersOf(board, unumber) }
}

const decideInTx = (unumber, requestId, { decision, comment }) => transaction(async (tx) => {
  if (!(decision in DECISIONS)) throw httpError(400, 'decisao invalida')
  const note = text(comment, 1000, 'comentario', { required: decision !== 'approve' })
  const { row } = await loadChange(unumber, requestId, tx)
  const board = (await findBoard(unumber, row.board_id, tx, { lock: true, allowProtected: true }))
  if (row.status !== 'open') throw httpError(409, 'a proposta nao esta aguardando revisao')
  if (row.author_unumber === unumber) throw httpError(403, 'o autor nao pode decidir a propria proposta')
  if (!await isReviewer(unumber, board, tx)) throw httpError(403, 'apenas o time revisor pode decidir')

  let mergedCommitId = null
  if (decision === 'approve') {
    const head = await headCommit(board, tx)
    if (head.commit_id.toLowerCase() !== row.base_commit_id.toLowerCase()) throw httpError(409, 'o quadro original mudou depois da proposta: o autor precisa atualizar a copia antes da aprovacao')
    const graph = sanitizeGraph(JSON.parse(row.proposed_json))
    await replaceGraph(tx, board.board_id, graph, unumber)
    await bumpVersion(board.board_id, tx)
    const message = `Mudança aprovada: ${row.title} (autor ${row.author_name ?? row.author_unumber})`.slice(0, 500)
    mergedCommitId = (await insertCommit(tx, board.board_id, board.head_branch_id, { commit_id: head.commit_id }, unumber, message, graph)).id
    await query('UPDATE flowcraft.boards SET is_archived = 1 WHERE board_id = @forkId', { forkId: uuid(row.fork_board_id) }, tx)
  }
  await query(
    `UPDATE flowcraft.change_requests SET status = @status, decided_by = @unumber, decision_comment = @note, decided_at = SYSUTCDATETIME(),
       merged_commit_id = @merged, updated_at = SYSUTCDATETIME() WHERE request_id = @requestId`,
    { requestId: uuid(requestId), status: [sql.VarChar(20), DECISIONS[decision]], unumber: unumberParam(unumber), note: [sql.NVarChar(1000), note], merged: uuid(mergedCommitId) }, tx,
  )
  await audit(unumber, `change_${decision}`, { boardId: row.board_id, target: requestId, detail: note }, tx)
  return { merged: decision === 'approve', authorUnumber: row.author_unumber, boardName: board.name }
})

export const decideChange = async (unumber, requestId, body) => {
  const result = await decideInTx(unumber, requestId, body)
  return { ...result, change: await getChange(unumber, requestId) }
}

// Traz as mudancas do quadro original para a copia (merge de tres vias); conflitos nao sao aplicados.
export const updateChange = (unumber, requestId) => transaction(async (tx) => {
  const { row, board } = await loadChange(unumber, requestId, tx)
  requireAuthor(row, unumber)
  if (![...OPEN_FOR_EDIT, 'open'].includes(row.status)) throw httpError(409, 'a proposta nao pode ser atualizada neste estado')
  const head = await headCommit(board, tx)
  if (head.commit_id.toLowerCase() === row.base_commit_id.toLowerCase()) return { updated: false, upToDate: true, conflicts: [] }

  const baseRow = (await query('SELECT snapshot_json FROM flowcraft.commits WHERE commit_id = @id', { id: uuid(row.base_commit_id) }, tx)).recordset[0]
  const base = sanitizeGraph(JSON.parse(baseRow.snapshot_json))
  const mine = sanitizeGraph(await readGraph(row.fork_board_id, tx))
  const theirs = sanitizeGraph(JSON.parse(head.snapshot_json))
  const { graph, conflicts } = mergeGraphs(base, mine, theirs)
  if (conflicts.length) {
    const titles = new Map([...mine.nodes, ...theirs.nodes].map((node) => [node.id, node.title || node.shapeKey || node.type]))
    return { updated: false, upToDate: false, conflicts: conflicts.map((id) => ({ id, title: titles.get(id) ?? 'seta' })) }
  }
  await replaceGraph(tx, row.fork_board_id, sanitizeGraph(graph), unumber)
  await bumpVersion(row.fork_board_id, tx)
  // Proposta aberta volta a rascunho: precisa ser reenviada com a copia atualizada.
  await query("UPDATE flowcraft.change_requests SET base_commit_id = @baseId, status = CASE WHEN status = 'open' THEN 'draft' ELSE status END, updated_at = SYSUTCDATETIME() WHERE request_id = @requestId",
    { requestId: uuid(requestId), baseId: uuid(head.commit_id) }, tx)
  await audit(unumber, 'change_update', { boardId: row.board_id, target: requestId }, tx)
  return { updated: true, upToDate: false, conflicts: [] }
})

export const cancelChange = async (unumber, requestId) => {
  const { row, board } = await loadChange(unumber, requestId)
  const role = await roleFor(unumber, board)
  if (row.author_unumber !== unumber && role !== 'owner') throw httpError(403, 'permissao insuficiente')
  if (['merged', 'rejected', 'cancelled'].includes(row.status)) throw httpError(409, 'a proposta ja foi encerrada')
  await query("UPDATE flowcraft.change_requests SET status = 'cancelled', updated_at = SYSUTCDATETIME() WHERE request_id = @requestId", { requestId: uuid(requestId) })
  await audit(unumber, 'change_cancel', { boardId: row.board_id, target: requestId })
  return getChange(unumber, requestId)
}
