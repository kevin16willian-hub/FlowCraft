import * as oidc from 'openid-client'
import { REDIRECT_URI, getOidcConfig } from '../config/entra.js'
import { env } from '../config/env.js'
import { isAdmin } from '../db/access.js'
import { isUserActive, upsertUser } from '../db/users.js'
import { log, redirect, send } from '../utils/http.js'
import { cookie, getCookie, getSession, sign, verify } from '../utils/session.js'

const UNUMBER_PATTERN = /^U\d{5,8}$/

// preferred_username (u133467@straumann.com) -> U133467
const toUnumber = (preferredUsername) => String(preferredUsername ?? '').split('@')[0].trim().toUpperCase()

export const login = async (_request, response) => {
  const config = await getOidcConfig()
  const codeVerifier = oidc.randomPKCECodeVerifier()
  const state = oidc.randomState()
  const nonce = oidc.randomNonce()
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: REDIRECT_URI,
    scope: 'openid profile email',
    response_type: 'code',
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: 'S256',
    state,
    nonce,
  })
  const pending = sign({ codeVerifier, state, nonce, exp: Date.now() / 1000 + 600 })
  redirect(response, url.href, [cookie('fc_auth', pending, 600)])
}

export const callback = async (request, response) => {
  const pending = verify(getCookie(request, 'fc_auth'))
  if (!pending) return redirect(response, '/api/auth/login')

  const config = await getOidcConfig()
  const tokens = await oidc.authorizationCodeGrant(config, new URL(`${env.APP_URL}${request.url}`), {
    pkceCodeVerifier: pending.codeVerifier,
    expectedState: pending.state,
    expectedNonce: pending.nonce,
    idTokenExpected: true,
  })
  const claims = tokens.claims()
  const unumber = toUnumber(claims.preferred_username)

  if (claims.tid !== env.AZURE_TENANT_ID || !UNUMBER_PATTERN.test(unumber)) {
    log('login_denied', { unumber, tid: claims.tid })
    return send(response, 403, { error: 'acesso negado' }, { 'Set-Cookie': cookie('fc_auth', '', 0) })
  }

  const email = String(claims.email ?? claims.preferred_username).toLowerCase()
  const name = claims.name ? String(claims.name) : undefined
  const oid = typeof claims.oid === 'string' ? claims.oid : undefined
  await upsertUser({ unumber, email, name, oid })
  if (!await isUserActive(unumber)) {
    log('login_denied', { unumber, reason: 'inativo' })
    return send(response, 403, { error: 'acesso negado' }, { 'Set-Cookie': cookie('fc_auth', '', 0) })
  }

  log('login_ok', { unumber })
  const session = sign({ unumber, email, name, exp: Date.now() / 1000 + env.SESSION_TTL })
  return redirect(response, '/', [cookie('fc_session', session, env.SESSION_TTL), cookie('fc_auth', '', 0)])
}

export const logout = (_request, response) => redirect(response, '/', [cookie('fc_session', '', 0)])

export const me = async (request, response) => {
  const session = getSession(request)
  return session
    ? send(response, 200, { unumber: session.unumber, email: session.email, name: session.name, isAdmin: await isAdmin(session.unumber) })
    : send(response, 401, { error: 'nao autenticado' })
}
