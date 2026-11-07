import { httpError } from '../utils/http.js'
import { findBoard } from './boards.js'
import { query, sql } from './pool.js'

const uuid = (value) => [sql.UniqueIdentifier, value]
const unumberParam = (value) => [sql.VarChar(20), value]

const toComment = (row) => ({
  id: row.comment_id,
  nodeId: row.node_id,
  parentId: row.parent_id,
  author: { unumber: row.author_unumber, name: row.display_name },
  body: row.body,
  mentions: row.mentions_json ? JSON.parse(row.mentions_json) : [],
  resolved: row.is_resolved,
  severity: row.severity ?? null,
  createdAt: row.created_at,
})

const SELECT = `SELECT c.*, u.display_name FROM flowcraft.comments c JOIN flowcraft.users u ON u.unumber = c.author_unumber`

export const listComments = async (unumber, boardId) => {
  await findBoard(unumber, boardId)
  const { recordset } = await query(`${SELECT} WHERE c.board_id = @boardId ORDER BY c.created_at`, { boardId: uuid(boardId) })
  return recordset.map(toComment)
}

const findComment = async (boardId, commentId) => {
  const { recordset } = await query(`${SELECT} WHERE c.board_id = @boardId AND c.comment_id = @commentId`, { boardId: uuid(boardId), commentId: uuid(commentId) })
  if (!recordset[0]) throw httpError(404, 'comentario nao encontrado')
  return recordset[0]
}

const SEVERITIES = ['issue', 'warning', 'ok']

export const addComment = async (unumber, boardId, { body, nodeId, parentId, severity }) => {
  const board = await findBoard(unumber, boardId)
  const text = typeof body === 'string' ? body.trim() : ''
  if (!text || text.length > 2000) throw httpError(400, 'comentario obrigatorio (ate 2000 caracteres)')
  if (nodeId != null && (typeof nodeId !== 'string' || !/^[\w.:-]{1,64}$/.test(nodeId))) throw httpError(400, 'nodeId invalido')
  if (severity != null && !SEVERITIES.includes(severity)) throw httpError(400, 'severidade invalida')

  const candidates = [...new Set([...text.matchAll(/@(U\d{5,8})\b/gi)].map((match) => match[1].toUpperCase()))].slice(0, 10)
  let mentions = []
  if (candidates.length) {
    const found = await query(`SELECT unumber FROM flowcraft.users WHERE unumber IN (${candidates.map((_, index) => `@u${index}`).join(',')})`,
      Object.fromEntries(candidates.map((value, index) => [`u${index}`, unumberParam(value)])))
    mentions = found.recordset.map((row) => row.unumber)
  }
  const created = await query(
    `INSERT INTO flowcraft.comments (board_id, node_id, parent_id, author_unumber, body, mentions_json, severity) OUTPUT inserted.comment_id
     VALUES (@boardId, @nodeId, @parentId, @unumber, @body, @mentions, @severity)`,
    {
      boardId: uuid(boardId), nodeId: [sql.NVarChar(64), nodeId ?? null], parentId: uuid(parentId ?? null), unumber: unumberParam(unumber),
      body: [sql.NVarChar(2000), text], severity: [sql.VarChar(10), severity ?? null], mentions: [sql.NVarChar(500), mentions.length ? JSON.stringify(mentions) : null],
    },
  )
  return { comment: toComment(await findComment(boardId, created.recordset[0].comment_id)), boardName: board.name }
}

export const setResolved = async (unumber, boardId, commentId, resolved) => {
  const board = await findBoard(unumber, boardId)
  const row = await findComment(boardId, commentId)
  if (row.author_unumber !== unumber && board.role === 'viewer') throw httpError(403, 'permissao insuficiente')
  await query('UPDATE flowcraft.comments SET is_resolved = @resolved WHERE comment_id = @commentId', { resolved: [sql.Bit, resolved === true], commentId: uuid(commentId) })
  return toComment(await findComment(boardId, commentId))
}

export const deleteComment = async (unumber, boardId, commentId) => {
  const board = await findBoard(unumber, boardId)
  const row = await findComment(boardId, commentId)
  if (row.author_unumber !== unumber && board.role !== 'owner') throw httpError(403, 'permissao insuficiente')
  await query('DELETE FROM flowcraft.comments WHERE comment_id = @commentId OR parent_id = @commentId', { commentId: uuid(commentId) })
  return toComment(row)
}
