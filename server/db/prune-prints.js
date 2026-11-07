import { DeleteObjectsCommand, ListObjectsV2Command } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'
import { s3 } from '../config/s3.js'
import { NAME_PATTERN } from '../controllers/prints.controller.js'
import { getPool } from './pool.js'

// Lista (e com --apply remove) prints do S3 sem referencia em working copies nem commits. Ignora arquivos com menos de 1 dia.
const apply = process.argv.includes('--apply')
const GRACE_MS = 24 * 60 * 60 * 1000
const pool = await getPool()

const referenced = new Set()
for (const row of (await pool.request().query('SELECT file_name FROM flowcraft.attachments')).recordset) referenced.add(row.file_name)
for (const row of (await pool.request().query('SELECT snapshot_json FROM flowcraft.commits')).recordset) {
  for (const match of row.snapshot_json.matchAll(/print-[0-9a-f-]{36}\.(?:png|jpg|webp)/g)) referenced.add(match[0])
}

const orphans = []
let token
do {
  const page = await s3.send(new ListObjectsV2Command({ Bucket: env.BUCKET, Prefix: 'prints/', ContinuationToken: token }))
  for (const object of page.Contents ?? []) {
    const name = object.Key.slice('prints/'.length)
    if (NAME_PATTERN.test(name) && !referenced.has(name) && Date.now() - object.LastModified.getTime() > GRACE_MS) orphans.push(object.Key)
  }
  token = page.NextContinuationToken
} while (token)

console.log(`${referenced.size} referenciados, ${orphans.length} orfaos`)
orphans.forEach((key) => console.log(`  ${key}`))

if (apply) {
  for (let index = 0; index < orphans.length; index += 1000) {
    const batch = orphans.slice(index, index + 1000).map((Key) => ({ Key }))
    await s3.send(new DeleteObjectsCommand({ Bucket: env.BUCKET, Delete: { Objects: batch } }))
  }
  console.log(`${orphans.length} removidos`)
} else if (orphans.length) console.log('Simulacao: use --apply para remover.')
await pool.close()
