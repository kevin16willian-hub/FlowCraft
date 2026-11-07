import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '../config/env.js'

export const sign = (payload) => {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${data}.${createHmac('sha256', env.SESSION_SECRET).update(data).digest('base64url')}`
}

export const verify = (token) => {
  const [data, mac] = (token ?? '').split('.')
  if (!data || !mac) return null
  const expected = createHmac('sha256', env.SESSION_SECRET).update(data).digest()
  const given = Buffer.from(mac, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    return payload.exp > Date.now() / 1000 ? payload : null
  } catch { return null }
}

export const getCookie = (request, name) => {
  const match = (request.headers.cookie ?? '').split(/;\s*/).find((part) => part.startsWith(`${name}=`))
  return match ? match.slice(name.length + 1) : undefined
}

export const cookie = (name, value, maxAge) =>
  `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${env.SECURE ? '; Secure' : ''}`

export const getSession = (request) => verify(getCookie(request, 'fc_session'))
