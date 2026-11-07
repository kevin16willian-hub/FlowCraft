import { redirect, send } from '../utils/http.js'
import { getSession } from '../utils/session.js'

// Retorna true quando a requisicao foi barrada. Preenche request.user quando autenticada.
export const requireAuth = (request, response, pathname) => {
  const session = getSession(request)
  if (session?.unumber) {
    request.user = { unumber: session.unumber, email: session.email, name: session.name }
    return false
  }
  if (pathname.startsWith('/api/')) send(response, 401, { error: 'nao autenticado' })
  else redirect(response, '/api/auth/login')
  return true
}
