import { createServer } from 'node:http'
import { env } from './config/env.js'
import { ensureInitialAdmins } from './db/access.js'
import { flushAll } from './realtime/hub.js'
import { route } from './routes/index.js'
import { log, send } from './utils/http.js'

await ensureInitialAdmins().catch((error) => log('admin_seed_failed', { message: error.message }))

createServer(async (request, response) => {
  const { pathname } = new URL(request.url ?? '/', 'http://localhost')
  const started = Date.now()
  response.on('finish', () => log('request', { method: request.method, path: pathname, status: response.statusCode, ms: Date.now() - started }))

  try {
    await route(request, response, pathname)
  } catch (error) {
    log('error', { path: pathname, name: error.name, message: error.message })
    if (!response.headersSent) {
      const duplicate = error.number === 2601 || error.number === 2627
      const status = duplicate ? 409 : (error.status ?? 500)
      const message = error.status === 413 ? 'payload maior que o limite'
        : duplicate ? 'registro duplicado'
        : error.expose ? error.message : 'erro interno'
      send(response, status, { error: message })
    } else response.end()
  }
}).listen(env.PORT, env.HOST, () => log('listening', { host: env.HOST, port: env.PORT, bucket: env.BUCKET, region: env.REGION }))

// Grava as salas ao vivo antes de encerrar (pm2 restart / deploy).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => { void flushAll().finally(() => process.exit(0)) })
}
