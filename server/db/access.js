import { httpError } from '../utils/http.js'
import { query, sql } from './pool.js'

export const ROLE_RANK = { viewer: 1, editor: 2, owner: 3 }
const ROLE_NAMES = [null, 'viewer', 'editor', 'owner']

const unumberParam = (value) => [sql.VarChar(20), value]
const uuid = (value) => [sql.UniqueIdentifier, value]

export const isAdmin = async (unumber, executor) => {
  const { recordset } = await query('SELECT 1 AS ok FROM flowcraft.admins WHERE unumber = @unumber', { unumber: unumberParam(unumber) }, executor)
  return recordset.length > 0
}

// Admins iniciais vem de INITIAL_ADMINS (lista de unumbers separada por virgula).
export const ensureInitialAdmins = async (list = process.env.INITIAL_ADMINS ?? '') => {
  for (const raw of list.split(',')) {
    const unumber = raw.trim().toUpperCase()
    if (!/^U\d{5,8}$/.test(unumber)) continue
    await query(
      `IF NOT EXISTS (SELECT 1 FROM flowcraft.users WHERE unumber = @unumber)
         INSERT INTO flowcraft.users (unumber, email) VALUES (@unumber, LOWER(@unumber) + N'@straumann.com');
       IF NOT EXISTS (SELECT 1 FROM flowcraft.admins WHERE unumber = @unumber)
         INSERT INTO flowcraft.admins (unumber, granted_by) VALUES (@unumber, NULL);`,
      { unumber: unumberParam(unumber) },
    )
  }
}

// Revisor: membro do time revisor do quadro (ou admin global).
export const isReviewer = async (unumber, board, executor) => {
  if (await isAdmin(unumber, executor)) return true
  if (!board.review_team_id) return false
  const { recordset } = await query('SELECT 1 AS ok FROM flowcraft.team_members WHERE team_id = @teamId AND unumber = @unumber',
    { teamId: uuid(board.review_team_id), unumber: unumberParam(unumber) }, executor)
  return recordset.length > 0
}

// Papel efetivo no quadro: owner (dono ou admin global), editor, viewer ou null (sem acesso).
export const roleFor = async (unumber, board, executor) => {
  const { recordset } = await query(
    `SELECT CASE
       WHEN @owner = @unumber OR EXISTS (SELECT 1 FROM flowcraft.admins WHERE unumber = @unumber) THEN 3
       ELSE ISNULL((SELECT MAX(CASE s.role WHEN 'editor' THEN 2 ELSE 1 END)
                    FROM flowcraft.board_shares s
                    WHERE s.board_id = @boardId
                      AND (s.user_unumber = @unumber OR s.team_id IN (SELECT team_id FROM flowcraft.team_members WHERE unumber = @unumber))), 0)
     END AS rank`,
    { owner: unumberParam(board.owner_unumber), unumber: unumberParam(unumber), boardId: uuid(board.board_id) }, executor,
  )
  return ROLE_NAMES[recordset[0].rank]
}

// 404 para quem nao enxerga o quadro (nao revela existencia); 403 quando o papel nao basta.
export const assertRole = (role, min) => {
  if (!role) throw httpError(404, 'quadro nao encontrado')
  if (ROLE_RANK[role] < ROLE_RANK[min]) throw httpError(403, 'permissao insuficiente')
}

export const audit = (actor, action, { boardId = null, teamId = null, target = null, detail = null } = {}, executor) => query(
  `INSERT INTO flowcraft.audit_log (actor, action, board_id, team_id, target, detail)
   VALUES (@actor, @action, @boardId, @teamId, @target, @detail)`,
  {
    actor: unumberParam(actor), action: [sql.VarChar(60), action], boardId: uuid(boardId), teamId: uuid(teamId),
    target: [sql.NVarChar(200), target], detail: [sql.NVarChar(500), detail],
  }, executor,
)
