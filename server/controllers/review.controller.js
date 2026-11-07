import { cancelChange, changeOfFork, decideChange, getChange, listChanges, openChange, pendingChanges, setProtection, submitChange, updateChange } from '../db/reviews.js'
import { broadcastBoard, flush, notifyUser, refreshAccess, resetRoom } from '../realtime/hub.js'
import { guid } from '../utils/graph-schema.js'
import { readJson, send } from '../utils/http.js'

const SMALL_JSON = 16 * 1024
const me = ({ request }) => request.user.unumber
const by = ({ request }) => request.user.name ?? request.user.unumber

export const reviewRoutes = [
  ['PUT', '/api/boards/:id/protection', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const boardId = guid(ctx.params.id)
    await flush(boardId)
    const result = await setProtection(me(ctx), boardId, { protect: body.protected === true, teamId: body.teamId ? guid(body.teamId, 'teamId') : undefined })
    await resetRoom(boardId)
    void broadcastBoard(boardId, { t: 'version', kind: 'protection', by: by(ctx), message: result.protected ? 'protegeu o quadro' : 'removeu a proteção' })
    await refreshAccess(boardId)
    send(ctx.response, 200, result)
  }],

  ['GET', '/api/boards/:id/changes', async (ctx) => send(ctx.response, 200, await listChanges(me(ctx), guid(ctx.params.id)))],
  ['GET', '/api/boards/:id/change', async (ctx) => send(ctx.response, 200, await changeOfFork(me(ctx), guid(ctx.params.id)))],

  ['POST', '/api/boards/:id/changes', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const change = await openChange(me(ctx), guid(ctx.params.id), { title: body.title, description: body.description, assignee: body.assignee })
    if (change.author.unumber !== me(ctx)) notifyUser(change.author.unumber, { kind: 'review', boardId: change.forkBoardId, boardName: change.title, by: by(ctx), text: 'abriu uma mudança para você editar' })
    send(ctx.response, 201, change)
  }],

  ['GET', '/api/changes', async (ctx) => {
    const scope = ctx.query.get('scope') === 'review' ? 'review' : 'mine'
    send(ctx.response, 200, await pendingChanges(me(ctx), scope))
  }],
  ['GET', '/api/changes/:requestId', async (ctx) => send(ctx.response, 200, await getChange(me(ctx), guid(ctx.params.requestId, 'requestId'), { withProposal: true }))],

  ['POST', '/api/changes/:requestId/submit', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const requestId = guid(ctx.params.requestId, 'requestId')
    await flush((await getChange(me(ctx), requestId)).forkBoardId)
    const { change, reviewers } = await submitChange(me(ctx), requestId, body)
    for (const unumber of reviewers) notifyUser(unumber, { kind: 'review', boardId: change.boardId, boardName: change.boardName, by: by(ctx), text: `pediu revisão: ${change.title}` })
    send(ctx.response, 200, change)
  }],

  ['POST', '/api/changes/:requestId/decision', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const result = await decideChange(me(ctx), guid(ctx.params.requestId, 'requestId'), { decision: body.decision, comment: body.comment })
    const { change } = result
    if (result.merged) {
      await resetRoom(change.boardId)
      void broadcastBoard(change.boardId, { t: 'version', kind: 'restore', by: by(ctx), message: `mudança aprovada: ${change.title}` })
    }
    const verb = { merged: 'aprovou', changes_requested: 'pediu ajustes em', rejected: 'rejeitou' }[change.status]
    if (result.authorUnumber !== me(ctx)) notifyUser(result.authorUnumber, { kind: 'review', boardId: change.forkBoardId, boardName: change.boardName, by: by(ctx), text: `${verb} sua mudança: ${change.title}` })
    send(ctx.response, 200, change)
  }],

  ['POST', '/api/changes/:requestId/update', async (ctx) => {
    const requestId = guid(ctx.params.requestId, 'requestId')
    const { forkBoardId } = await getChange(me(ctx), requestId)
    await flush(forkBoardId)
    const result = await updateChange(me(ctx), requestId)
    if (result.updated) {
      await resetRoom(forkBoardId)
      void broadcastBoard(forkBoardId, { t: 'version', kind: 'restore', by: by(ctx), message: 'copia atualizada com o quadro original' })
    }
    send(ctx.response, 200, result)
  }],

  ['POST', '/api/changes/:requestId/cancel', async (ctx) => {
    send(ctx.response, 200, await cancelChange(me(ctx), guid(ctx.params.requestId, 'requestId')))
  }],
]
