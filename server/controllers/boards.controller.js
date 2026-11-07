import { broadcastBoard, flush, isLive, refreshAccess, resetRoom } from '../realtime/hub.js'
import { collabRoutes } from './collab.controller.js'
import { reviewRoutes } from './review.controller.js'
import { rtRoutes } from './rt.controller.js'
import { createBoard, deleteBoard, getBoardWithGraph, listBoards, saveGraph, updateBoard } from '../db/boards.js'
import { listShapes, recordUsage, suggestShapes } from '../db/shapes.js'
import { checkout, createBranch, createCommit, createTag, getCommit, listBranches, listCommits, listTags } from '../db/versions.js'
import { guid } from '../utils/graph-schema.js'
import { httpError, readJson, send } from '../utils/http.js'
import { createRouter } from '../utils/router.js'

const SMALL_JSON = 64 * 1024
const BOARD_KINDS = ['flowchart', 'aws']

const user = ({ request }) => request.user.unumber

const boardName = (value) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > 200) throw httpError(400, 'nome obrigatorio (ate 200 caracteres)')
  return value.trim()
}

const optionalText = (value, max, field) => {
  if (value == null) return null
  if (typeof value !== 'string' || value.length > max) throw httpError(400, `${field} invalido`)
  return value
}

const optionalGuid = (value, field) => (value == null ? undefined : guid(value, field))

export const handleApi = createRouter([
  ['GET', '/api/boards', async (ctx) => send(ctx.response, 200, await listBoards(user(ctx), { archived: ctx.query.get('archived') === '1', scope: ctx.query.get('scope') ?? 'accessible' }))],

  ['POST', '/api/boards', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const kind = body.kind ?? 'flowchart'
    if (!BOARD_KINDS.includes(kind)) throw httpError(400, 'tipo de quadro invalido')
    const board = await createBoard(user(ctx), { name: boardName(body.name), description: optionalText(body.description, 1000, 'description'), settings: kind === 'flowchart' ? null : { kind } })
    send(ctx.response, 201, board)
  }],

  // A sala ao vivo pode ter alteracoes ainda nao gravadas: grava antes de ler.
  ['GET', '/api/boards/:id', async (ctx) => {
    const id = guid(ctx.params.id)
    await flush(id)
    send(ctx.response, 200, await getBoardWithGraph(user(ctx), id))
  }],

  ['PATCH', '/api/boards/:id', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const changes = {}
    if ('name' in body) changes.name = boardName(body.name)
    if ('description' in body) changes.description = optionalText(body.description, 1000, 'description')
    if ('viewport' in body) changes.viewport = body.viewport
    if ('settings' in body) changes.settings = body.settings
    if ('archived' in body) changes.archived = body.archived === true
    send(ctx.response, 200, await updateBoard(user(ctx), guid(ctx.params.id), changes))
  }],

  // Exclusao logica: o quadro e o historico ficam preservados (archived=false restaura).
  ['DELETE', '/api/boards/:id', async (ctx) => {
    await updateBoard(user(ctx), guid(ctx.params.id), { archived: true })
    send(ctx.response, 204)
  }],

  ['DELETE', '/api/boards/:id/permanent', async (ctx) => {
    const id = guid(ctx.params.id)
    await flush(id)
    await deleteBoard(user(ctx), id)
    await refreshAccess(id)
    send(ctx.response, 204)
  }],

  ['PUT', '/api/boards/:id/graph', async (ctx) => {
    const id = guid(ctx.params.id)
    if (isLive(id)) throw httpError(409, 'quadro em edicao ao vivo; reconecte para sincronizar')
    send(ctx.response, 200, await saveGraph(user(ctx), id, await readJson(ctx.request)))
  }],

  ['GET', '/api/boards/:id/commits', async (ctx) => send(ctx.response, 200, await listCommits(user(ctx), guid(ctx.params.id), Number(ctx.query.get('limit')) || 100))],

  ['POST', '/api/boards/:id/commits', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const id = guid(ctx.params.id)
    await flush(id)
    const commit = await createCommit(user(ctx), id, { message: body.message, autosave: body.autosave })
    void broadcastBoard(id, { t: 'version', kind: 'commit', by: ctx.request.user.name ?? user(ctx), message: commit.message })
    send(ctx.response, 201, commit)
  }],

  ['GET', '/api/boards/:id/commits/:commitId', async (ctx) => send(ctx.response, 200, await getCommit(user(ctx), guid(ctx.params.id), guid(ctx.params.commitId, 'commitId')))],

  ['POST', '/api/boards/:id/checkout', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const id = guid(ctx.params.id)
    await flush(id)
    const keepWorkingCopy = body.keepWorkingCopy === true
    const result = await checkout(user(ctx), id, { branchId: optionalGuid(body.branchId, 'branchId'), commitId: optionalGuid(body.commitId, 'commitId'), keepWorkingCopy })
    const by = ctx.request.user.name ?? user(ctx)
    if (keepWorkingCopy) void broadcastBoard(id, { t: 'version', kind: 'branch', by })
    else { await resetRoom(id); void broadcastBoard(id, { t: 'version', kind: 'restore', by }) }
    send(ctx.response, 200, result)
  }],

  ['GET', '/api/boards/:id/branches', async (ctx) => send(ctx.response, 200, await listBranches(user(ctx), guid(ctx.params.id)))],

  ['POST', '/api/boards/:id/branches', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const branch = await createBranch(user(ctx), guid(ctx.params.id), { name: body.name, commitId: optionalGuid(body.commitId, 'commitId') })
    void broadcastBoard(guid(ctx.params.id), { t: 'version', kind: 'branch-created', by: ctx.request.user.name ?? user(ctx), message: branch.name })
    send(ctx.response, 201, branch)
  }],

  ['GET', '/api/boards/:id/tags', async (ctx) => send(ctx.response, 200, await listTags(user(ctx), guid(ctx.params.id)))],

  ['POST', '/api/boards/:id/tags', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    const tag = await createTag(user(ctx), guid(ctx.params.id), { name: body.name, commitId: optionalGuid(body.commitId, 'commitId'), message: optionalText(body.message, 500, 'message') })
    void broadcastBoard(guid(ctx.params.id), { t: 'version', kind: 'tag', by: ctx.request.user.name ?? user(ctx), message: tag.name })
    send(ctx.response, 201, tag)
  }],

  ['GET', '/api/shapes', async (ctx) => send(ctx.response, 200, await listShapes())],

  ['GET', '/api/shapes/suggestions', async (ctx) => {
    send(ctx.response, 200, await suggestShapes(user(ctx), ctx.query.get('from') || '*', Number(ctx.query.get('limit')) || 5))
  }],

  ['POST', '/api/shapes/usage', async (ctx) => {
    const body = await readJson(ctx.request, SMALL_JSON)
    await recordUsage(user(ctx), body.from ?? '*', body.to)
    send(ctx.response, 204)
  }],

  ...collabRoutes,
  ...rtRoutes,
  ...reviewRoutes,
])
