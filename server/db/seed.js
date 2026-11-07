import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getPool } from './pool.js'

// Executa docs/seed_sql.sql separando os lotes por linhas "GO".
const file = join(process.cwd(), 'docs', 'seed_sql.sql')
const batches = readFileSync(file, 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split(/^\s*GO\s*$/gim)
  .map((batch) => batch.trim())
  .filter(Boolean)

const pool = await getPool()
let done = 0
for (const batch of batches) {
  try {
    await pool.request().batch(batch)
    done += 1
  } catch (error) {
    console.error(`Falha no lote ${done + 1}/${batches.length}: ${error.message}`)
    console.error(batch.split('\n').slice(0, 3).join('\n'))
    await pool.close()
    process.exit(1)
  }
}
console.log(`Seed concluido: ${done}/${batches.length} lotes`)
await pool.close()
