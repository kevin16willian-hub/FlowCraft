import { httpError } from './http.js'

// Rotas no formato [metodo, '/api/boards/:id', handler(ctx)]; ctx = { request, response, params, query }.
export const createRouter = (routes) => {
  const compiled = routes.map(([method, path, handler]) => ({
    method,
    handler,
    names: [...path.matchAll(/:(\w+)/g)].map((match) => match[1]),
    regex: new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}/?$`),
  }))

  // Retorna undefined se nenhuma rota casar; caso contrario, uma Promise.
  return (request, response, pathname) => {
    let pathMatched = false
    for (const route of compiled) {
      const match = route.regex.exec(pathname)
      if (!match) continue
      pathMatched = true
      if (route.method !== request.method) continue
      const params = Object.fromEntries(route.names.map((name, index) => [name, decodeURIComponent(match[index + 1])]))
      const query = new URL(request.url ?? '/', 'http://localhost').searchParams
      return Promise.resolve(route.handler({ request, response, params, query }))
    }
    if (pathMatched) throw httpError(405, 'metodo nao permitido')
    return undefined
  }
}
