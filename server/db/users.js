import { query, sql } from './pool.js'

export const upsertUser = ({ unumber, email, name, oid }) => query(
  `MERGE flowcraft.users AS t
   USING (SELECT @unumber AS unumber) AS s ON t.unumber = s.unumber
   WHEN MATCHED THEN UPDATE SET email = @email, display_name = @name, entra_oid = @oid, last_login_at = SYSUTCDATETIME()
   WHEN NOT MATCHED THEN INSERT (unumber, email, display_name, entra_oid, last_login_at)
     VALUES (@unumber, @email, @name, @oid, SYSUTCDATETIME());`,
  {
    unumber: [sql.VarChar(20), unumber],
    email: [sql.NVarChar(256), email],
    name: [sql.NVarChar(200), name ?? null],
    oid: [sql.UniqueIdentifier, oid ?? null],
  },
)

export const isUserActive = async (unumber) => {
  const { recordset } = await query('SELECT is_active FROM flowcraft.users WHERE unumber = @unumber', { unumber: [sql.VarChar(20), unumber] })
  return recordset[0]?.is_active === true
}
