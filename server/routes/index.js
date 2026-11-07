import { callback, login, logout, me } from '../controllers/auth.microsoft.controller.js'
import { handleApi } from '../controllers/boards.controller.js'
import { CALLBACK_PATH } from '../config/entra.js'
import { API_PREFIX, handlePrints } from '../controllers/prints.controller.js'
import { serveStatic } from '../controllers/static.controller.js'
import { requireAuth } from '../middleware/auth.middleware.js'
import { send } from '../utils/http.js'

const authRoutes = {
  '/api/auth/login': login,
  [CALLBACK_PATH]: callback,
  '/api/auth/logout': logout,
  '/api/auth/me': me,
}

export const route = async (request, response, pathname) => {
  if (pathname === '/health') return send(response, 200, { status: 'ok' })

  if (pathname.startsWith('/api/auth/')) {
    const handler = authRoutes[pathname]
    return handler ? handler(request, response) : send(response, 404, { error: 'nao encontrado' })
  }

  if (requireAuth(request, response, pathname)) return undefined

  if (pathname.startsWith(API_PREFIX)) return handlePrints(request, response, pathname)
  if (pathname.startsWith('/api/')) {
    const handled = handleApi(request, response, pathname)
    return handled ?? send(response, 404, { error: 'nao encontrado' })
  }
  return serveStatic(request, response, pathname)
}
