import { httpError } from '../utils/http.js'
import { query, sql } from './pool.js'

const toShape = (row) => ({
  key: row.shape_key,
  label: row.label,
  type: row.node_type,
  width: row.default_width,
  height: row.default_height,
  style: row.default_style_json ? JSON.parse(row.default_style_json) : null,
})

export const listShapes = async () => {
  const { recordset } = await query('SELECT * FROM flowcraft.shape_catalog WHERE is_active = 1 ORDER BY sort_order')
  return recordset.map(toShape)
}

const suggestionsFor = (unumber, from, limit) => query(
  `SELECT TOP (@limit) c.*
   FROM flowcraft.shape_catalog c
   LEFT JOIN flowcraft.suggestion_stats s
     ON s.owner_unumber = @unumber AND s.from_shape_key = @from AND s.to_shape_key = c.shape_key
   LEFT JOIN flowcraft.shape_suggestion_defaults d ON d.from_shape_key = @from AND d.to_shape_key = c.shape_key
   WHERE c.is_active = 1 AND (s.to_shape_key IS NOT NULL OR d.to_shape_key IS NOT NULL)
   ORDER BY ISNULL(s.use_count, 0) DESC, ISNULL(d.rank_order, 255), c.sort_order`,
  { unumber: [sql.VarChar(20), unumber], from: [sql.VarChar(40), from], limit: [sql.Int, limit] },
)

// Ordena por uso do proprio usuario e completa com os padroes da forma e depois os genericos ('*').
export const suggestShapes = async (unumber, from = '*', limit = 5) => {
  const size = Math.min(Math.max(limit, 1), 12)
  const picked = []
  const seen = new Set()
  const add = (rows) => {
    for (const row of rows) {
      if (picked.length < size && !seen.has(row.shape_key)) { seen.add(row.shape_key); picked.push(row) }
    }
  }
  add((await suggestionsFor(unumber, from, size)).recordset)
  if (from !== '*') add((await suggestionsFor(unumber, '*', size)).recordset)
  return picked.map(toShape)
}

export const recordUsage = async (unumber, from, to) => {
  if (typeof from !== 'string' || typeof to !== 'string' || from.length > 40 || to.length > 40) throw httpError(400, 'from e to obrigatorios')
  const { recordset } = await query('SELECT 1 AS ok FROM flowcraft.shape_catalog WHERE shape_key = @to', { to: [sql.VarChar(40), to] })
  if (!recordset.length) throw httpError(400, 'forma desconhecida')
  const params = { unumber: [sql.VarChar(20), unumber], from: [sql.VarChar(40), from], to: [sql.VarChar(40), to] }
  // Registra a transicao especifica e a generica ('*') usada como fallback.
  await query(
    `MERGE flowcraft.suggestion_stats AS t
     USING (SELECT DISTINCT owner_unumber, from_shape_key, to_shape_key
            FROM (VALUES (@unumber, @from, @to), (@unumber, '*', @to)) AS v (owner_unumber, from_shape_key, to_shape_key)) AS s
       ON t.owner_unumber = s.owner_unumber AND t.from_shape_key = s.from_shape_key AND t.to_shape_key = s.to_shape_key
     WHEN MATCHED THEN UPDATE SET use_count = t.use_count + 1, last_used_at = SYSUTCDATETIME()
     WHEN NOT MATCHED THEN INSERT (owner_unumber, from_shape_key, to_shape_key, use_count) VALUES (s.owner_unumber, s.from_shape_key, s.to_shape_key, 1);`,
    params,
  )
}
