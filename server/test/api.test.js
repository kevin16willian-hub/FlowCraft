import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { after, before, describe, it } from 'node:test'
import { getPool, query, sql } from '../db/pool.js'
import { upsertUser } from '../db/users.js'
import { sign } from '../utils/session.js'
import { sanitizeGraph } from '../utils/graph-schema.js'

// Roda o servidor em porta efemera com usuarios de teste (U9000xx) e limpa tudo ao final. Nao toca no S3.
const USERS = { owner: 'U900001', editor: 'U900002', viewer: 'U900003', stranger: 'U900004', admin: 'U900005', teamMate: 'U900006' }
const ALL = Object.values(USERS)
const PORT = 3200 + Math.floor(Math.random() * 500)
const BASE = `http://127.0.0.1:${PORT}`
let child
const cookies = {}

const as = (who) => async (method, path, body) => {
  const response = await fetch(BASE + path, { method, headers: { Cookie: cookies[who], 'Content-Type': 'application/json' }, ...(body && { body: JSON.stringify(body) }) })
  return { status: response.status, body: response.status === 204 ? null : await response.json() }
}
const api = as('owner')

const node = (id, type, shapeKey, extra = {}) => ({ id, type, shapeKey, x: 0, y: 0, width: 100, height: 60, title: id, ...extra })

describe('sanitizeGraph', () => {
  it('converte area legada em phase', () => {
    const graph = sanitizeGraph({ nodes: [node('a', 'area', 'area'), node('b', 'area', null), node('c', 'area', 'lane')], edges: [] })
    assert.deepEqual(graph.nodes.map((item) => item.shapeKey), ['phase', 'phase', 'lane'])
  })

  it('rejeita tipo invalido e ids duplicados', () => {
    assert.throws(() => sanitizeGraph({ nodes: [node('a', 'xx', null)], edges: [] }))
    assert.throws(() => sanitizeGraph({ nodes: [node('a', 'stage', 'stage'), node('a', 'stage', 'stage')], edges: [] }))
  })
})

describe('API de quadros', () => {
  before(async () => {
    for (const [who, unumber] of Object.entries(USERS)) {
      const email = `${unumber.toLowerCase()}@example.invalid`
      await upsertUser({ unumber, email, name: `Teste ${who}` })
      cookies[who] = `fc_session=${sign({ unumber, email, name: `Teste ${who}`, exp: Math.floor(Date.now() / 1000) + 600 })}`
    }
    await query('INSERT INTO flowcraft.admins (unumber) VALUES (@u)', { u: [sql.VarChar(20), USERS.admin] })
    child = spawn(process.execPath, ['server/app.js'], { env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', APP_URL: BASE }, stdio: 'ignore' })
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if (await fetch(`${BASE}/health`).then((response) => response.ok, () => false)) return
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    throw new Error('servidor nao iniciou')
  })

  after(async () => {
    child?.kill()
    const list = ALL.map((unumber) => `'${unumber}'`).join(',')
    await query(`DELETE FROM flowcraft.boards WHERE owner_unumber IN (${list})`)
    await query(`DELETE FROM flowcraft.teams WHERE created_by IN (${list})`)
    await query(`DELETE FROM flowcraft.admins WHERE unumber IN (${list})`)
    await query(`DELETE FROM flowcraft.suggestion_stats WHERE owner_unumber IN (${list})`)
    await query(`DELETE FROM flowcraft.audit_log WHERE actor IN (${list})`)
    await query(`DELETE FROM flowcraft.comments WHERE author_unumber IN (${list})`)
    await query(`DELETE FROM flowcraft.users WHERE unumber IN (${list})`)
    await (await getPool()).close()
  })

  it('exige autenticacao', async () => {
    assert.equal((await fetch(`${BASE}/api/boards`)).status, 401)
  })

  it('cria quadro, salva grafo, versiona e restaura', async () => {
    const board = (await api('POST', '/api/boards', { name: 'teste' })).body
    const url = `/api/boards/${board.id}`
    const graph = { nodes: [node('lane-1', 'area', 'lane'), node('legacy', 'area', 'area'), node('s1', 'stage', 'stage', { parentId: 'lane-1' })], edges: [] }

    assert.equal((await api('PUT', `${url}/graph`, graph)).status, 200)
    const loaded = (await api('GET', url)).body
    assert.equal(loaded.nodes.find((item) => item.id === 'legacy').shapeKey, 'phase')

    assert.equal((await api('POST', `${url}/commits`, { message: 'v1' })).status, 201)
    assert.equal((await api('POST', `${url}/commits`, { message: 'igual' })).status, 409)

    await api('PUT', `${url}/graph`, { nodes: [], edges: [] })
    const commits = (await api('GET', `${url}/commits`)).body
    const v1 = commits.find((item) => item.message === 'v1')
    assert.equal((await api('POST', `${url}/checkout`, { commitId: v1.id })).status, 200)
    assert.equal((await api('GET', url)).body.nodes.length, 3)
  })

  it('sugere proximos itens para inicio e condicao', async () => {
    for (const from of ['start', 'gateway']) {
      const { body } = await api('GET', `/api/shapes/suggestions?from=${from}`)
      assert.ok(body.length >= 3, `${from} sem sugestoes`)
    }
  })

  it('responde 404 para print inexistente', async () => {
    assert.equal((await fetch(`${BASE}/api/process-prints/print-00000000-0000-0000-0000-000000000000.png`, { headers: { Cookie: cookies.owner } })).status, 404)
  })

describe('Colaboracao e permissoes', () => {
  const editor = as('editor')
  const viewer = as('viewer')
  const stranger = as('stranger')
  const admin = as('admin')
  let boardId

  before(async () => {
    boardId = (await api('POST', '/api/boards', { name: 'colab' })).body.id
    await api('PUT', `/api/boards/${boardId}/graph`, { nodes: [node('s1', 'stage', 'stage')], edges: [] })
  })

  it('quem nao tem acesso recebe 404', async () => {
    assert.equal((await stranger('GET', `/api/boards/${boardId}`)).status, 404)
    assert.equal((await stranger('GET', `/api/boards/${boardId}/shares`)).status, 404)
  })

  it('so o dono compartilha e aceita unumber pendente', async () => {
    const shared = await api('POST', `/api/boards/${boardId}/shares`, { unumber: USERS.viewer, role: 'viewer' })
    assert.equal(shared.status, 200)
    assert.equal(shared.body.shares[0].role, 'viewer')
    assert.equal((await api('POST', `/api/boards/${boardId}/shares`, { unumber: USERS.editor, role: 'editor' })).status, 200)
    assert.equal((await viewer('POST', `/api/boards/${boardId}/shares`, { unumber: USERS.stranger, role: 'viewer' })).status, 403)
    assert.equal((await api('POST', `/api/boards/${boardId}/shares`, { unumber: 'U999991', role: 'viewer' })).body.shares.find((item) => item.unumber === 'U999991').pending, true)
    await query("DELETE FROM flowcraft.board_shares WHERE user_unumber = 'U999991'")
    await query("DELETE FROM flowcraft.users WHERE unumber = 'U999991'")
  })

  it('viewer le mas nao escreve; editor escreve mas nao compartilha', async () => {
    assert.equal((await viewer('GET', `/api/boards/${boardId}`)).body.role, 'viewer')
    assert.equal((await viewer('PUT', `/api/boards/${boardId}/graph`, { nodes: [], edges: [] })).status, 403)
    assert.equal((await viewer('POST', `/api/boards/${boardId}/commits`, { message: 'x' })).status, 403)
    assert.equal((await viewer('GET', `/api/boards/${boardId}/commits`)).status, 200)
    assert.equal((await editor('PUT', `/api/boards/${boardId}/graph`, { nodes: [node('s1', 'stage', 'stage'), node('s2', 'stage', 'stage')], edges: [] })).status, 200)
    assert.equal((await editor('POST', `/api/boards/${boardId}/commits`, { message: 'do editor' })).status, 201)
    assert.equal((await editor('PATCH', `/api/boards/${boardId}`, { archived: true })).status, 403)
    assert.equal((await editor('DELETE', `/api/boards/${boardId}`)).status, 403)
  })

  it('lista quadros compartilhados por escopo', async () => {
    const shared = (await viewer('GET', '/api/boards?scope=shared')).body
    assert.ok(shared.some((item) => item.id === boardId && item.role === 'viewer'))
    assert.equal((await stranger('GET', '/api/boards')).body.some((item) => item.id === boardId), false)
  })

  it('edicao concorrente devolve 409', async () => {
    const current = (await api('GET', `/api/boards/${boardId}`)).body
    assert.equal((await api('PUT', `/api/boards/${boardId}/graph`, { nodes: [node('s1', 'stage', 'stage')], edges: [], rowVersion: current.rowVersion })).status, 200)
    assert.equal((await editor('PUT', `/api/boards/${boardId}/graph`, { nodes: [], edges: [], rowVersion: current.rowVersion })).status, 409)
  })

  it('viewport do dono nao invalida a versao do grafo', async () => {
    const before = (await api('GET', `/api/boards/${boardId}`)).body.rowVersion
    await api('PATCH', `/api/boards/${boardId}`, { viewport: { x: 1, y: 2, zoom: 1 } })
    assert.equal((await api('GET', `/api/boards/${boardId}`)).body.rowVersion, before)
  })

  // Cliente SSE de teste: acumula eventos e permite esperar por um deles.
  const connect = async (who, since) => {
    const clientId = `cl-${who}-12345678`
    const url = `${BASE}/api/boards/${boardId}/stream?clientId=${clientId}${since === undefined ? '' : `&since=${since}`}`
    const controller = new AbortController()
    const response = await fetch(url, { headers: { Cookie: cookies[who] }, signal: controller.signal })
    assert.equal(response.status, 200)
    const events = []
    const waiters = []
    void (async () => {
      const decoder = new TextDecoder()
      let buffer = ''
      try {
        for await (const chunk of response.body) {
          buffer += decoder.decode(chunk, { stream: true })
          let cut
          while ((cut = buffer.indexOf('\n\n')) >= 0) {
            const line = buffer.slice(0, cut).split('\n').find((item) => item.startsWith('data: '))
            buffer = buffer.slice(cut + 2)
            if (line) { events.push(JSON.parse(line.slice(6))); waiters.forEach((check) => check()) }
          }
        }
      } catch { /* fechado pelo teste */ }
    })()
    const waitFor = (predicate, timeout = 3000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`evento nao chegou: ${JSON.stringify(events.slice(-4))}`)), timeout)
      const check = () => { const hit = events.find(predicate); if (hit) { clearTimeout(timer); resolve(hit) } }
      waiters.push(check)
      check()
    })
    const post = (body) => fetch(`${BASE}/api/boards/${boardId}/rt`, { method: 'POST', headers: { Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId, ...body }) })
    return { clientId, events, waitFor, post, close: () => controller.abort() }
  }

  it('tempo real: ops chegam aos outros, versao avanca e PUT fica bloqueado', async () => {
    const owner = await connect('owner')
    const peer = await connect('editor')
    await owner.waitFor((event) => event.t === 'hello')
    const hello = await peer.waitFor((event) => event.t === 'hello')
    assert.equal(hello.roster.length, 1)
    assert.equal(hello.role, 'editor')
    await owner.waitFor((event) => event.t === 'join')

    const response = await owner.post({ ops: { nodes: [node('live1', 'stage', 'stage', { x: 10 })] } })
    assert.equal(response.status, 204)
    const received = await peer.waitFor((event) => event.t === 'ops')
    assert.equal(received.ops.nodes[0].id, 'live1')
    assert.equal(received.v, hello.version + 1)
    assert.equal((await api('PUT', `/api/boards/${boardId}/graph`, { nodes: [], edges: [] })).status, 409)
    assert.ok((await api('GET', `/api/boards/${boardId}`)).body.nodes.some((item) => item.id === 'live1'))

    owner.close()
    peer.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  it('tempo real: leitor nao envia ops mas envia cursor; invalido e rejeitado', async () => {
    const owner = await connect('owner')
    const reader = await connect('viewer')
    await reader.waitFor((event) => event.t === 'hello')
    assert.equal((await reader.post({ ops: { nodes: [node('x1', 'stage', 'stage')] } })).status, 403)
    assert.equal((await reader.post({ cursor: { x: 5, y: 6 } })).status, 204)
    const state = await owner.waitFor((event) => event.t === 'state' && event.patch.cursor)
    assert.deepEqual(state.patch.cursor, { x: 5, y: 6, laser: false })
    assert.equal((await owner.post({ ops: { nodes: [node('bad', 'xx', null)] } })).status, 400)
    owner.close()
    reader.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  it('tempo real: reconexao com since repete o que faltou; bloqueio de elemento', async () => {
    const owner = await connect('owner')
    const first = await owner.waitFor((event) => event.t === 'hello')
    const peer = await connect('editor')
    await peer.waitFor((event) => event.t === 'hello')
    peer.close()
    await owner.post({ ops: { nodes: [node('live2', 'stage', 'stage')] } })
    await owner.waitFor((event) => event.t === 'ops' && event.ops.nodes[0]?.id === 'live2')
    const back = await connect('editor', first.version)
    const hello = await back.waitFor((event) => event.t === 'hello')
    assert.equal(hello.resync, false)
    await back.waitFor((event) => event.t === 'ops' && event.ops.nodes[0]?.id === 'live2')

    await back.post({ holding: ['live2'] })
    await new Promise((resolve) => setTimeout(resolve, 100))
    const before = owner.events.length
    await owner.post({ ops: { nodes: [node('live2', 'stage', 'stage', { x: 999 })] } })
    await new Promise((resolve) => setTimeout(resolve, 200))
    assert.equal(owner.events.slice(before).some((event) => event.t === 'ops'), false)

    owner.close()
    back.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  it('tempo real: comentarios com mencao, chat, versao e permissao ao vivo', async () => {
    const owner = await connect('owner')
    const mate = await connect('editor')
    await mate.waitFor((event) => event.t === 'hello')
    await owner.post({ chat: 'ola time' })
    assert.equal((await mate.waitFor((event) => event.t === 'chat')).message.text, 'ola time')

    const comment = await api('POST', `/api/boards/${boardId}/comments`, { body: `veja isto @${USERS.editor}`, nodeId: 's1' })
    assert.equal(comment.status, 201)
    assert.deepEqual(comment.body.mentions, [USERS.editor])
    await mate.waitFor((event) => event.t === 'notify' && event.kind === 'mention')
    await mate.waitFor((event) => event.t === 'comment' && event.action === 'add')
    assert.equal((await api('PATCH', `/api/boards/${boardId}/comments/${comment.body.id}`, { resolved: true })).body.resolved, true)

    await api('POST', `/api/boards/${boardId}/commits`, { message: 'ao vivo' })
    assert.equal((await mate.waitFor((event) => event.t === 'version')).kind, 'commit')

    const shares = (await api('GET', `/api/boards/${boardId}/shares`)).body.shares
    const mine = shares.find((item) => item.unumber === USERS.editor)
    await api('PATCH', `/api/boards/${boardId}/shares/${mine.id}`, { role: 'viewer' })
    assert.equal((await mate.waitFor((event) => event.t === 'role')).role, 'viewer')
    await api('PATCH', `/api/boards/${boardId}/shares/${mine.id}`, { role: 'editor' })

    const online = (await as('admin')('GET', '/api/admin/online')).body
    assert.ok(online.some((room) => room.boardId.toLowerCase() === boardId.toLowerCase() && room.clients.length === 2))
    assert.equal((await stranger('GET', '/api/admin/online')).status, 403)

    await api('DELETE', `/api/boards/${boardId}/shares/${mine.id}`)
    await mate.waitFor((event) => event.t === 'kicked')
    await api('POST', `/api/boards/${boardId}/shares`, { unumber: USERS.editor, role: 'editor' })
    owner.close()
    mate.close()
    await new Promise((resolve) => setTimeout(resolve, 300))
  })

  it('time: membros enxergam quadros compartilhados com o time', async () => {
    const team = (await api('POST', '/api/teams', { name: 'Time teste 9000' })).body
    assert.equal((await stranger('GET', `/api/teams/${team.id}`)).status, 404)
    assert.equal((await api('POST', `/api/teams/${team.id}/members`, { unumber: USERS.teamMate, role: 'member' })).status, 200)
    assert.equal((await as('teamMate')('POST', `/api/teams/${team.id}/members`, { unumber: USERS.stranger })).status, 403)
    assert.equal((await api('POST', `/api/boards/${boardId}/shares`, { teamId: team.id, role: 'viewer' })).status, 200)
    assert.equal((await as('teamMate')('GET', `/api/boards/${boardId}`)).body.role, 'viewer')
    assert.equal((await api('DELETE', `/api/teams/${team.id}/members/${USERS.owner}`)).status, 409)
    const detail = (await as('teamMate')('GET', `/api/teams/${team.id}`)).body
    assert.ok(detail.boards.some((item) => item.id === boardId))
  })

  it('revisao: quadro protegido, proposta, aprovacao e bloqueio por mudanca no original', async () => {
    const author = as('editor')
    const reviewer = as('teamMate')
    const team = (await api('POST', '/api/teams', { name: 'Revisores 9000' })).body
    await api('POST', `/api/teams/${team.id}/members`, { unumber: USERS.teamMate, role: 'member' })
    await api('POST', `/api/boards/${boardId}/commits`, { message: 'base da revisao' })

    assert.equal((await api('PUT', `/api/boards/${boardId}/protection`, { protected: true, teamId: team.id })).status, 200)
    assert.equal((await author('PUT', `/api/boards/${boardId}/graph`, { nodes: [], edges: [] })).status, 403)

    const propose = async (title, nodeId) => {
      const change = (await author('POST', `/api/boards/${boardId}/changes`, { title })).body
      const fork = (await author('GET', `/api/boards/${change.forkBoardId}`)).body
      assert.equal(fork.role, 'owner')
      const saved = await author('PUT', `/api/boards/${change.forkBoardId}/graph`, { nodes: [...fork.nodes, node(nodeId, 'stage', 'stage')], edges: [] })
      assert.equal(saved.status, 200)
      return change
    }

    const first = await propose('mudanca 1', 'rev-a')
    const second = await propose('mudanca 2', 'rev-b')
    assert.equal((await author('POST', `/api/changes/${first.id}/submit`, {})).body.status, 'open')
    assert.equal((await author('POST', `/api/changes/${second.id}/submit`, {})).status, 200)
    assert.ok((await reviewer('GET', '/api/changes?scope=review')).body.some((item) => item.id === first.id))

    assert.equal((await author('POST', `/api/changes/${first.id}/decision`, { decision: 'approve' })).status, 403)
    assert.equal((await reviewer('POST', `/api/changes/${first.id}/decision`, { decision: 'request_changes' })).status, 400)
    assert.equal((await reviewer('POST', `/api/changes/${second.id}/decision`, { decision: 'approve' })).body.status, 'merged')
    assert.ok((await api('GET', `/api/boards/${boardId}`)).body.nodes.some((item) => item.id === 'rev-b'))

    const blocked = await reviewer('POST', `/api/changes/${first.id}/decision`, { decision: 'approve' })
    assert.equal(blocked.status, 409)
    assert.equal((await author('GET', `/api/changes/${first.id}`)).body.outdated, true)

    const refreshed = await author('POST', `/api/changes/${first.id}/update`, {})
    assert.equal(refreshed.body.updated, true, JSON.stringify(refreshed))
    assert.equal((await author('POST', `/api/changes/${first.id}/submit`, {})).status, 200)
    assert.equal((await reviewer('POST', `/api/changes/${first.id}/decision`, { decision: 'approve' })).body.status, 'merged')
    const ids = (await api('GET', `/api/boards/${boardId}`)).body.nodes.map((item) => item.id)
    assert.ok(ids.includes('rev-a') && ids.includes('rev-b'))

    assert.equal((await api('PUT', `/api/boards/${boardId}/protection`, { protected: false })).status, 200)
  })

  it('admin global ve tudo e transfere a propriedade', async () => {
    assert.equal((await stranger('GET', '/api/admin/users')).status, 403)
    assert.equal((await admin('GET', `/api/boards/${boardId}`)).body.role, 'owner')
    assert.ok((await admin('GET', '/api/admin/boards')).body.some((item) => item.id === boardId))
    assert.equal((await admin('POST', `/api/boards/${boardId}/transfer`, { unumber: USERS.editor })).status, 200)
    assert.equal((await editor('GET', `/api/boards/${boardId}`)).body.role, 'owner')
    assert.ok((await admin('GET', '/api/admin/audit')).body.some((item) => item.action === 'board_transfer'))
  })
})
})
