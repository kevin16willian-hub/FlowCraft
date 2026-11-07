import { httpError } from '../utils/http.js'
import { audit, isAdmin } from './access.js'
import { findBoard } from './boards.js'
import { query, sql, transaction } from './pool.js'

const uuid = (value) => [sql.UniqueIdentifier, value]
const unumberParam = (value) => [sql.VarChar(20), value]
const UNUMBER_PATTERN = /^U\d{5,8}$/

export const normalizeUnumber = (value) => {
  const unumber = String(value ?? '').split('@')[0].trim().toUpperCase()
  if (!UNUMBER_PATTERN.test(unumber)) throw httpError(400, 'unumber invalido')
  return unumber
}

const shareRole = (value) => {
  if (value !== 'viewer' && value !== 'editor') throw httpError(400, 'papel invalido (viewer ou editor)')
  return value
}

const textField = (value, max, field, required = false) => {
  if (value == null || value === '') {
    if (required) throw httpError(400, `${field} obrigatorio`)
    return null
  }
  if (typeof value !== 'string' || value.trim().length > max) throw httpError(400, `${field} invalido`)
  return value.trim()
}

// Quem ainda nao entrou no sistema vira um usuario pendente; o primeiro login preenche nome e e-mail.
const ensureUser = (unumber, domain, executor) => query(
  `IF NOT EXISTS (SELECT 1 FROM flowcraft.users WHERE unumber = @unumber)
     INSERT INTO flowcraft.users (unumber, email) VALUES (@unumber, LOWER(@unumber) + N'@' + @domain)`,
  { unumber: unumberParam(unumber), domain: [sql.NVarChar(200), domain] }, executor,
)

export const emailDomain = (email) => String(email ?? '').split('@')[1] || 'straumann.com'

export const searchUsers = async (term) => {
  const text = String(term ?? '').trim()
  if (text.length < 2) return []
  const { recordset } = await query(
    `SELECT TOP (10) unumber, display_name, email, last_login_at FROM flowcraft.users
     WHERE is_active = 1 AND (unumber LIKE @like OR display_name LIKE @like OR email LIKE @like)
     ORDER BY display_name, unumber`,
    { like: [sql.NVarChar(210), `%${text.replace(/[%_[]/g, '')}%`] },
  )
  return recordset.map((row) => ({ unumber: row.unumber, name: row.display_name, email: row.email, pending: row.last_login_at === null }))
}

/* ---------------- Compartilhamento de quadros ---------------- */

export const listShares = async (unumber, boardId) => {
  const board = await findBoard(unumber, boardId, undefined, { min: 'owner' })
  const { recordset } = await query(
    `SELECT s.share_id, s.role, s.granted_at, s.user_unumber, u.display_name, u.last_login_at, s.team_id, t.name AS team_name
     FROM flowcraft.board_shares s
     LEFT JOIN flowcraft.users u ON u.unumber = s.user_unumber
     LEFT JOIN flowcraft.teams t ON t.team_id = s.team_id
     WHERE s.board_id = @boardId ORDER BY s.granted_at`,
    { boardId: uuid(boardId) },
  )
  const owner = (await query('SELECT unumber, display_name FROM flowcraft.users WHERE unumber = @unumber', { unumber: unumberParam(board.owner_unumber) })).recordset[0]
  return {
    owner: { unumber: owner.unumber, name: owner.display_name },
    shares: recordset.map((row) => (row.team_id
      ? { id: row.share_id, type: 'team', teamId: row.team_id, name: row.team_name, role: row.role, grantedAt: row.granted_at }
      : { id: row.share_id, type: 'user', unumber: row.user_unumber, name: row.display_name, pending: row.last_login_at === null, role: row.role, grantedAt: row.granted_at })),
  }
}

export const addShare = (actor, domain, boardId, body) => transaction(async (tx) => {
  const role = shareRole(body.role)
  const board = await findBoard(actor, boardId, tx, { min: 'owner' })
  let target
  let column
  let label
  if (body.teamId) {
    column = 'team_id'
    target = uuid(body.teamId)
    const team = (await query('SELECT name FROM flowcraft.teams WHERE team_id = @id AND is_archived = 0', { id: target }, tx)).recordset[0]
    if (!team) throw httpError(404, 'time nao encontrado')
    if (!await isAdmin(actor, tx)) {
      const member = await query('SELECT 1 AS ok FROM flowcraft.team_members WHERE team_id = @id AND unumber = @actor', { id: target, actor: unumberParam(actor) }, tx)
      if (!member.recordset.length) throw httpError(404, 'time nao encontrado')
    }
    label = team.name
  } else {
    column = 'user_unumber'
    const unumber = normalizeUnumber(body.unumber)
    if (unumber === board.owner_unumber) throw httpError(400, 'a pessoa ja e dona do quadro')
    await ensureUser(unumber, domain, tx)
    target = unumberParam(unumber)
    label = unumber
  }
  const params = { boardId: uuid(boardId), target, role: [sql.VarChar(10), role], actor: unumberParam(actor) }
  const updated = await query(`UPDATE flowcraft.board_shares SET role = @role, granted_by = @actor, granted_at = SYSUTCDATETIME() WHERE board_id = @boardId AND ${column} = @target`, params, tx)
  if (!updated.rowsAffected[0]) {
    await query(`INSERT INTO flowcraft.board_shares (board_id, ${column}, role, granted_by) VALUES (@boardId, @target, @role, @actor)`, params, tx)
  }
  await audit(actor, 'share_set', { boardId, target: label, detail: role }, tx)
})

export const updateShare = async (actor, boardId, shareId, roleValue) => {
  const role = shareRole(roleValue)
  await findBoard(actor, boardId, undefined, { min: 'owner' })
  const { rowsAffected } = await query('UPDATE flowcraft.board_shares SET role = @role WHERE share_id = @shareId AND board_id = @boardId',
    { role: [sql.VarChar(10), role], shareId: uuid(shareId), boardId: uuid(boardId) })
  if (!rowsAffected[0]) throw httpError(404, 'compartilhamento nao encontrado')
  await audit(actor, 'share_role', { boardId, target: shareId, detail: role })
}

export const removeShare = async (actor, boardId, shareId) => {
  const board = await findBoard(actor, boardId, undefined, { min: 'viewer' })
  const row = (await query('SELECT user_unumber FROM flowcraft.board_shares WHERE share_id = @shareId AND board_id = @boardId', { shareId: uuid(shareId), boardId: uuid(boardId) })).recordset[0]
  if (!row) throw httpError(404, 'compartilhamento nao encontrado')
  // Quem recebeu o acesso pode abrir mao dele; remover os outros exige ser dono.
  if (row.user_unumber !== actor) await findBoard(actor, boardId, undefined, { min: 'owner' })
  await query('DELETE FROM flowcraft.board_shares WHERE share_id = @shareId', { shareId: uuid(shareId) })
  await audit(actor, 'share_removed', { boardId: board.board_id, target: shareId })
}

export const transferBoard = (actor, domain, boardId, newOwner) => transaction(async (tx) => {
  const board = await findBoard(actor, boardId, tx, { min: 'owner', lock: true })
  const unumber = normalizeUnumber(newOwner)
  if (unumber === board.owner_unumber) throw httpError(400, 'a pessoa ja e dona do quadro')
  await ensureUser(unumber, domain, tx)
  await query('DELETE FROM flowcraft.board_shares WHERE board_id = @boardId AND user_unumber = @unumber', { boardId: uuid(boardId), unumber: unumberParam(unumber) }, tx)
  await query('UPDATE flowcraft.boards SET owner_unumber = @unumber, updated_at = SYSUTCDATETIME() WHERE board_id = @boardId', { boardId: uuid(boardId), unumber: unumberParam(unumber) }, tx)
  await audit(actor, 'board_transfer', { boardId, target: unumber, detail: `de ${board.owner_unumber}` }, tx)
  return { ownerUnumber: unumber }
})

/* ---------------- Times ---------------- */

const TEAM_RANK = { member: 1, team_admin: 2 }

const teamRoleOf = async (unumber, teamId, executor) => {
  if (await isAdmin(unumber, executor)) return 'team_admin'
  const { recordset } = await query('SELECT role FROM flowcraft.team_members WHERE team_id = @teamId AND unumber = @unumber', { teamId: uuid(teamId), unumber: unumberParam(unumber) }, executor)
  return recordset[0]?.role ?? null
}

const requireTeamRole = async (unumber, teamId, min, executor) => {
  const role = await teamRoleOf(unumber, teamId, executor)
  if (!role) throw httpError(404, 'time nao encontrado')
  if (TEAM_RANK[role] < TEAM_RANK[min]) throw httpError(403, 'permissao insuficiente')
  const { recordset } = await query('SELECT * FROM flowcraft.teams WHERE team_id = @teamId', { teamId: uuid(teamId) }, executor)
  if (!recordset[0]) throw httpError(404, 'time nao encontrado')
  return { team: recordset[0], role }
}

export const listTeams = async (unumber, { all = false } = {}) => {
  const admin = all && await isAdmin(unumber)
  const { recordset } = await query(
    `SELECT t.team_id, t.name, t.description, t.is_archived, m.role,
       (SELECT COUNT(*) FROM flowcraft.team_members x WHERE x.team_id = t.team_id) AS member_count,
       (SELECT COUNT(*) FROM flowcraft.board_shares s WHERE s.team_id = t.team_id) AS board_count
     FROM flowcraft.teams t
     LEFT JOIN flowcraft.team_members m ON m.team_id = t.team_id AND m.unumber = @unumber
     WHERE t.is_archived = 0 AND (@all = 1 OR m.unumber IS NOT NULL)
     ORDER BY t.name`,
    { unumber: unumberParam(unumber), all: [sql.Bit, admin] },
  )
  return recordset.map((row) => ({ id: row.team_id, name: row.name, description: row.description, role: row.role ?? 'team_admin', memberCount: row.member_count, boardCount: row.board_count }))
}

export const createTeam = (unumber, body) => transaction(async (tx) => {
  const name = textField(body.name, 100, 'nome', true)
  const created = await query(
    'INSERT INTO flowcraft.teams (name, description, created_by) OUTPUT inserted.team_id VALUES (@name, @description, @unumber)',
    { name: [sql.NVarChar(100), name], description: [sql.NVarChar(500), textField(body.description, 500, 'descricao')], unumber: unumberParam(unumber) }, tx,
  )
  const teamId = created.recordset[0].team_id
  await query(`INSERT INTO flowcraft.team_members (team_id, unumber, role, added_by) VALUES (@teamId, @unumber, 'team_admin', @unumber)`, { teamId: uuid(teamId), unumber: unumberParam(unumber) }, tx)
  await audit(unumber, 'team_created', { teamId, target: name }, tx)
  return { id: teamId, name }
})

export const getTeam = async (unumber, teamId) => {
  const { team, role } = await requireTeamRole(unumber, teamId, 'member')
  const members = (await query(
    `SELECT m.unumber, m.role, m.added_at, u.display_name, u.last_login_at FROM flowcraft.team_members m
     JOIN flowcraft.users u ON u.unumber = m.unumber WHERE m.team_id = @teamId ORDER BY u.display_name, m.unumber`,
    { teamId: uuid(teamId) },
  )).recordset
  const boards = (await query(
    `SELECT b.board_id, b.name, b.updated_at, b.owner_unumber, u.display_name AS owner_name, s.role
     FROM flowcraft.board_shares s JOIN flowcraft.boards b ON b.board_id = s.board_id AND b.is_archived = 0
     JOIN flowcraft.users u ON u.unumber = b.owner_unumber
     WHERE s.team_id = @teamId ORDER BY b.updated_at DESC`,
    { teamId: uuid(teamId) },
  )).recordset
  return {
    id: team.team_id, name: team.name, description: team.description, role,
    members: members.map((row) => ({ unumber: row.unumber, name: row.display_name, role: row.role, pending: row.last_login_at === null })),
    boards: boards.map((row) => ({ id: row.board_id, name: row.name, updatedAt: row.updated_at, ownerUnumber: row.owner_unumber, ownerName: row.owner_name, role: row.role })),
  }
}

export const updateTeam = async (unumber, teamId, body) => {
  await requireTeamRole(unumber, teamId, 'team_admin')
  const sets = []
  const params = { teamId: uuid(teamId) }
  if ('name' in body) { sets.push('name = @name'); params.name = [sql.NVarChar(100), textField(body.name, 100, 'nome', true)] }
  if ('description' in body) { sets.push('description = @description'); params.description = [sql.NVarChar(500), textField(body.description, 500, 'descricao')] }
  if (body.archived === true) sets.push('is_archived = 1')
  if (!sets.length) throw httpError(400, 'nada para atualizar')
  await query(`UPDATE flowcraft.teams SET ${sets.join(', ')} WHERE team_id = @teamId`, params)
  await audit(unumber, body.archived === true ? 'team_archived' : 'team_updated', { teamId })
}

const teamAdminCount = async (teamId, executor) => (await query(`SELECT COUNT(*) AS n FROM flowcraft.team_members WHERE team_id = @teamId AND role = 'team_admin'`, { teamId: uuid(teamId) }, executor)).recordset[0].n

export const setMember = (actor, domain, teamId, body) => transaction(async (tx) => {
  await requireTeamRole(actor, teamId, 'team_admin', tx)
  const unumber = normalizeUnumber(body.unumber)
  const role = body.role === 'team_admin' ? 'team_admin' : 'member'
  await ensureUser(unumber, domain, tx)
  const params = { teamId: uuid(teamId), unumber: unumberParam(unumber), role: [sql.VarChar(12), role], actor: unumberParam(actor) }
  const current = (await query('SELECT role FROM flowcraft.team_members WHERE team_id = @teamId AND unumber = @unumber', params, tx)).recordset[0]
  if (current) {
    if (current.role === 'team_admin' && role === 'member' && await teamAdminCount(teamId, tx) <= 1) throw httpError(409, 'o time precisa de ao menos um administrador')
    await query('UPDATE flowcraft.team_members SET role = @role WHERE team_id = @teamId AND unumber = @unumber', params, tx)
  } else {
    await query('INSERT INTO flowcraft.team_members (team_id, unumber, role, added_by) VALUES (@teamId, @unumber, @role, @actor)', params, tx)
  }
  await audit(actor, 'team_member_set', { teamId, target: unumber, detail: role }, tx)
})

export const removeMember = (actor, teamId, targetValue) => transaction(async (tx) => {
  const unumber = normalizeUnumber(targetValue)
  await requireTeamRole(actor, teamId, unumber === actor ? 'member' : 'team_admin', tx)
  const current = (await query('SELECT role FROM flowcraft.team_members WHERE team_id = @teamId AND unumber = @unumber', { teamId: uuid(teamId), unumber: unumberParam(unumber) }, tx)).recordset[0]
  if (!current) throw httpError(404, 'membro nao encontrado')
  if (current.role === 'team_admin' && await teamAdminCount(teamId, tx) <= 1) throw httpError(409, 'o time precisa de ao menos um administrador')
  await query('DELETE FROM flowcraft.team_members WHERE team_id = @teamId AND unumber = @unumber', { teamId: uuid(teamId), unumber: unumberParam(unumber) }, tx)
  await audit(actor, 'team_member_removed', { teamId, target: unumber }, tx)
})

/* ---------------- Administracao global ---------------- */

export const requireAdmin = async (unumber) => {
  if (!await isAdmin(unumber)) throw httpError(403, 'permissao insuficiente')
}

export const adminUsers = async () => {
  const { recordset } = await query(
    `SELECT u.unumber, u.display_name, u.email, u.is_active, u.last_login_at,
       (SELECT COUNT(*) FROM flowcraft.boards b WHERE b.owner_unumber = u.unumber AND b.is_archived = 0) AS board_count,
       (SELECT COUNT(*) FROM flowcraft.team_members m WHERE m.unumber = u.unumber) AS team_count,
       CASE WHEN EXISTS (SELECT 1 FROM flowcraft.admins a WHERE a.unumber = u.unumber) THEN 1 ELSE 0 END AS is_admin
     FROM flowcraft.users u ORDER BY u.display_name, u.unumber`,
  )
  return recordset.map((row) => ({
    unumber: row.unumber, name: row.display_name, email: row.email, active: row.is_active, lastLoginAt: row.last_login_at,
    boardCount: row.board_count, teamCount: row.team_count, admin: row.is_admin === 1,
  }))
}

export const setUserActive = async (actor, unumberValue, active) => {
  const unumber = normalizeUnumber(unumberValue)
  if (unumber === actor && !active) throw httpError(400, 'voce nao pode desativar a si mesmo')
  const { rowsAffected } = await query('UPDATE flowcraft.users SET is_active = @active WHERE unumber = @unumber', { active: [sql.Bit, active], unumber: unumberParam(unumber) })
  if (!rowsAffected[0]) throw httpError(404, 'usuario nao encontrado')
  await audit(actor, active ? 'user_activated' : 'user_deactivated', { target: unumber })
}

export const grantAdmin = (actor, domain, unumberValue) => transaction(async (tx) => {
  const unumber = normalizeUnumber(unumberValue)
  await ensureUser(unumber, domain, tx)
  await query('IF NOT EXISTS (SELECT 1 FROM flowcraft.admins WHERE unumber = @unumber) INSERT INTO flowcraft.admins (unumber, granted_by) VALUES (@unumber, @actor)',
    { unumber: unumberParam(unumber), actor: unumberParam(actor) }, tx)
  await audit(actor, 'admin_granted', { target: unumber }, tx)
})

export const revokeAdmin = (actor, unumberValue) => transaction(async (tx) => {
  const unumber = normalizeUnumber(unumberValue)
  const count = (await query('SELECT COUNT(*) AS n FROM flowcraft.admins', {}, tx)).recordset[0].n
  if (count <= 1) throw httpError(409, 'precisa existir ao menos um administrador')
  await query('DELETE FROM flowcraft.admins WHERE unumber = @unumber', { unumber: unumberParam(unumber) }, tx)
  await audit(actor, 'admin_revoked', { target: unumber }, tx)
})

export const listAudit = async (limit = 100) => {
  const { recordset } = await query(
    'SELECT TOP (@limit) audit_id, actor, action, board_id, team_id, target, detail, created_at FROM flowcraft.audit_log ORDER BY audit_id DESC',
    { limit: [sql.Int, Math.min(Math.max(limit, 1), 500)] },
  )
  return recordset.map((row) => ({ id: Number(row.audit_id), actor: row.actor, action: row.action, boardId: row.board_id, teamId: row.team_id, target: row.target, detail: row.detail, at: row.created_at }))
}
