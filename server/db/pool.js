import sql from 'mssql'
import { env } from '../config/env.js'

export { sql }

let pool
export const getPool = () => {
  pool ??= new sql.ConnectionPool({
    server: env.DB_SERVER,
    database: env.DB_DATABASE,
    user: env.DB_USERNAME,
    password: env.DB_PASSWORD,
    options: { encrypt: true, trustServerCertificate: true },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 30000,
  }).connect()
  // Permite nova tentativa na proxima chamada se a conexao inicial falhar.
  pool.catch(() => { pool = undefined })
  return pool
}

// params: { nome: [sql.Tipo, valor] }
export const query = async (text, params = {}, executor) => {
  const request = (executor ?? await getPool()).request()
  for (const [name, [type, value]] of Object.entries(params)) request.input(name, type, value)
  return request.query(text)
}

export const transaction = async (work) => {
  const tx = new sql.Transaction(await getPool())
  await tx.begin()
  try {
    const result = await work(tx)
    await tx.commit()
    return result
  } catch (error) {
    await tx.rollback().catch(() => {})
    throw error
  }
}
