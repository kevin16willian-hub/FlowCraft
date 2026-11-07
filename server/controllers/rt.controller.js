import { findBoard } from '../db/boards.js'
import { addComment, deleteComment, listComments, setResolved } from '../db/comments.js'
import { broadcastBoard, getJoinedRoom, handleMessage, joinRoom, listOnline, notifyUser } from '../realtime/hub.js'
import { requireAdmin } from '../db/collab.js'
import { guid } from '../utils/graph-schema.js'
import { httpError, readJson, send } from '../utils/http.js'

const RT_JSON = 1024 * 1024
const me = ({ request }) => request.user.unumber
const displayName = (ctx) => ctx.request.user.name ?? me(ctx)

export const rtRoutes = [
  // Canal SSE do quadro: so abre quando a pessoa esta ativa; o cliente fecha por inatividade.
  ['GET', '/api/boards/:id/stream', async (ctx) => {
    const boardId = guid(ctx.params.id)
    const board = await findBoard(me(ctx), boardId)
    const clientId = ctx.query.get('clientId')
    if (!clientId || !/^[\w-]{8,64}$/.test(clientId)) throw httpError(400, 'clientId invalido')
    const sinceValue = ctx.query.get('since')
    const since = sinceValue !== null && /^\d+$/.test(sinceValue) ? Number(sinceValue) : undefined
    await joinRoom({ boardId, board, user: { unumber: me(ctx), name: displayName(ctx) }, role: board.role, clientId, since, response: ctx.response })
  }],

  ['POST', '/api/boards/:id/rt', async (ctx) => {
    const boardId = guid(ctx.params.id)
    const body = await readJson(ctx.request, RT_JSON)
    const joined = await getJoinedRoom(boardId, String(body.clientId ?? ''))
    if (!joined || joined.client.user.unumber !== me(ctx)) throw httpError(409, 'conexao ao vivo nao encontrada')
    handleMessage(joined.room, joined.client, body)
    send(ctx.response, 204)
  }],

  ['GET', '/api/boards/:id/comments', async (ctx) => send(ctx.response, 200, await listComments(me(ctx), guid(ctx.params.id)))],
  ['POST', '/api/boards/:id/comments', async (ctx) => {
    const boardId = guid(ctx.params.id)
    const body = await readJson(ctx.request, 16 * 1024)
    const { comment, boardName } = await addComment(me(ctx), boardId, body)
    await broadcastBoard(boardId, { t: 'comment', action: 'add', comment })
    for (const unumber of comment.mentions) {
      if (unumber !== me(ctx)) notifyUser(unumber, { kind: 'mention', boardId, boardName, by: displayName(ctx), text: comment.body.slice(0, 120) })
    }
    send(ctx.response, 201, comment)
  }],
  ['PATCH', '/api/boards/:id/comments/:commentId', async (ctx) => {
    const boardId = guid(ctx.params.id)
    const body = await readJson(ctx.request, 4 * 1024)
    const comment = await setResolved(me(ctx), boardId, guid(ctx.params.commentId, 'commentId'), body.resolved)
    await broadcastBoard(boardId, { t: 'comment', action: 'update', comment })
    send(ctx.response, 200, comment)
  }],
  ['DELETE', '/api/boards/:id/comments/:commentId', async (ctx) => {
    const boardId = guid(ctx.params.id)
    const comment = await deleteComment(me(ctx), boardId, guid(ctx.params.commentId, 'commentId'))
    await broadcastBoard(boardId, { t: 'comment', action: 'delete', comment })
    send(ctx.response, 204)
  }],

  ['GET', '/api/admin/online', async (ctx) => {
    await requireAdmin(me(ctx))
    send(ctx.response, 200, await listOnline())
  }],
]

