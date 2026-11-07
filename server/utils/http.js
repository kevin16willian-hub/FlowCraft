import { env } from '../config/env.js'

export const log = (event, data = {}) => console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }))

export const send = (response, status, body, headers = {}) => {
  response.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  response.end(body === undefined ? undefined : JSON.stringify(body))
}

export const redirect = (response, location, cookies = []) => {
  response.writeHead(302, { Location: location, 'Set-Cookie': cookies })
  response.end()
}

export const readBody = (request, limit = env.MAX_BYTES) => new Promise((resolve, reject) => {
  const chunks = []
  let size = 0
  request.on('data', (chunk) => {
    size += chunk.length
    if (size > limit) {
      reject(Object.assign(new Error('payload too large'), { status: 413 }))
      request.destroy()
      return
    }
    chunks.push(chunk)
  })
  request.on('end', () => resolve(Buffer.concat(chunks)))
  request.on('error', reject)
})

export const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true })

export const readJson = async (request, limit = env.MAX_JSON_BYTES) => {
  const raw = (await readBody(request, limit)).toString('utf8')
  if (!raw) return {}
  try { return JSON.parse(raw) } catch { throw httpError(400, 'json invalido') }
}
