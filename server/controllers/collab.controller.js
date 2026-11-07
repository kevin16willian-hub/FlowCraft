import { findBoard, listBoards } from '../db/boards.js'
import { query, sql } from '../db/pool.js'
import {
  addShare, adminUsers, createTeam, emailDomain, getTeam, grantAdmin, listAudit, listShares, listTeams, removeMember, removeShare,
  requireAdmin, revokeAdmin, searchUsers, setMember, setUserActive, transferBoard, updateShare, updateTeam,
} from '../db/collab.js'
import { notifyUser, refreshAccess } from '../realtime/hub.js'
import { guid } from '../utils/graph-schema.js'
import { readJson, send } from '../utils/http.js'

const SMALL_JSON = 16 * 1024
const me = ({ request }) => request.user.unumber
const domain = ({ request }) => emailDomain(request.user.email)
const admin = async (ctx) => { await requireAdmin(me(ctx)) }

// Avisa quem recebeu o acesso (usuario ou membros do time) e ajusta quem ja esta no quadro.
const announceShare = async (ctx, boardId, body) => {
  const recipients = body.teamId
    ? (await query('SELECT unumber FROM flowcraft.team_members WHERE team_id = @teamId', { teamId: [sql.UniqueIdentifier, body.teamId] })).recordset.map((row) => row.unumber)
    : [String(body.unumber ?? '').split('@')[0].trim().toUpperCase()]
  const board = await findBoard(me(ctx), boardId)
  for (const unumber of recipients) {
    if (unumber !== me(ctx)) notifyUser(unumber, { kind: 'shared', boardId, boardName: board.name, by: ctx.request.user.name ?? me(ctx), role: body.role })
  }
  await refreshAccess(boardId)
}

export const collabRoutes = [
  ['GET', '/api/users/search', async (ctx) => send(ctx.response, 200, await searchUsers(ctx.query.get('q')))],

  ['GET', '/api/boards/:id/shares', async (ctx) => send(ctx.response, 200, await listShares(me(ctx), guid(ctx.params.id)))],
  ['POST', '/api/boards/:id/shares', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const boardId = guid(ctx.params.id)
    await addShare(me(ctx), domain(ctx), boardId, { unumber: body.unumber, teamId: body.teamId ? guid(body.teamId, 'teamId') : undefined, role: body.role })
    void announceShare(ctx, boardId, body)
    send(ctx.response, 200, await listShares(me(ctx), boardId))
  }],
  ['PATCH', '/api/boards/:id/shares/:shareId', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    await updateShare(me(ctx), guid(ctx.params.id), guid(ctx.params.shareId, 'shareId'), body.role)
    void refreshAccess(guid(ctx.params.id))
    send(ctx.response, 204)
  }],
  ['DELETE', '/api/boards/:id/shares/:shareId', async (ctx) => {
    await removeShare(me(ctx), guid(ctx.params.id), guid(ctx.params.shareId, 'shareId'))
    void refreshAccess(guid(ctx.params.id))
    send(ctx.response, 204)
  }],
  ['POST', '/api/boards/:id/transfer', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const result = await transferBoard(me(ctx), domain(ctx), guid(ctx.params.id), body.unumber)
    void refreshAccess(guid(ctx.params.id))
    notifyUser(result.ownerUnumber, { kind: 'shared', boardId: guid(ctx.params.id), by: ctx.request.user.name ?? me(ctx), role: 'owner' })
    send(ctx.response, 200, result)
  }],

  ['GET', '/api/teams', async (ctx) => send(ctx.response, 200, await listTeams(me(ctx), { all: ctx.query.get('all') === '1' }))],
  ['POST', '/api/teams', async (ctx) => send(ctx.response, 201, await createTeam(me(ctx), await readJson(ctx.request, SMALL_JSON)))],
  ['GET', '/api/teams/:id', async (ctx) => send(ctx.response, 200, await getTeam(me(ctx), guid(ctx.params.id)))],
  ['PATCH', '/api/teams/:id', async (ctx) => {
    await updateTeam(me(ctx), guid(ctx.params.id), await readJson(ctx.request, SMALL_JSON))
    void refreshAccess()
    send(ctx.response, 204)
  }],
  ['POST', '/api/teams/:id/members', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    await setMember(me(ctx), domain(ctx), guid(ctx.params.id), body)
    void refreshAccess()
    notifyUser(String(body.unumber ?? '').toUpperCase(), { kind: 'team', teamId: guid(ctx.params.id), by: ctx.request.user.name ?? me(ctx) })
    send(ctx.response, 200, await getTeam(me(ctx), guid(ctx.params.id)))
  }],
  ['DELETE', '/api/teams/:id/members/:unumber', async (ctx) => {
    await removeMember(me(ctx), guid(ctx.params.id), ctx.params.unumber)
    void refreshAccess()
    send(ctx.response, 204)
  }],

  ['GET', '/api/admin/users', async (ctx) => { await admin(ctx); send(ctx.response, 200, await adminUsers()) }],
  ['PATCH', '/api/admin/users/:unumber', async (ctx) => {
    await admin(ctx)
    const body = await readJson(ctx.request, SMALL_JSON)
    await setUserActive(me(ctx), ctx.params.unumber, body.active === true)
    send(ctx.response, 204)
  }],
  ['GET', '/api/admin/boards', async (ctx) => { await admin(ctx); send(ctx.response, 200, await listBoards(me(ctx), { scope: 'all', archived: ctx.query.get('archived') === '1' })) }],
  ['POST', '/api/admin/admins', async (ctx) => {
    await admin(ctx)
    await grantAdmin(me(ctx), domain(ctx), (await readJson(ctx.request, SMALL_JSON)).unumber)
    send(ctx.response, 204)
  }],
  ['DELETE', '/api/admin/admins/:unumber', async (ctx) => {
    await admin(ctx)
    await revokeAdmin(me(ctx), ctx.params.unumber)
    send(ctx.response, 204)
  }],
  ['GET', '/api/admin/audit', async (ctx) => { await admin(ctx); send(ctx.response, 200, await listAudit(Number(ctx.query.get('limit')) || 100)) }],
  ['GET', '/api/admin/teams', async (ctx) => { await admin(ctx); send(ctx.response, 200, await listTeams(me(ctx), { all: true })) }],
]

