import { randomUUID } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'
import { s3 } from '../config/s3.js'
import { log, readBody, send } from '../utils/http.js'

export const API_PREFIX = '/api/process-prints'

const EXTENSIONS = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' }
export const NAME_PATTERN = /^print-[0-9a-f-]{36}\.(png|jpg|webp)$/

export const handlePrints = async (request, response, pathname) => {
  const name = decodeURIComponent(pathname.slice(API_PREFIX.length).replace(/^\//, ''))

  if (request.method === 'POST' && !name) {
    const contentType = request.headers['content-type']?.split(';')[0].trim() ?? ''
    const extension = EXTENSIONS[contentType]
    if (!extension) return send(response, 415, { error: 'tipo nao suportado' })

    const body = await readBody(request)
    const filename = `print-${randomUUID()}${extension}`
    await s3.send(new PutObjectCommand({ Bucket: env.BUCKET, Key: `prints/${filename}`, Body: body, ContentType: contentType }))
    log('upload_ok', { key: `prints/${filename}`, bytes: body.length, contentType })
    return send(response, 200, { url: `${API_PREFIX}/${filename}`, name: filename })
  }

  if (!NAME_PATTERN.test(name)) return send(response, 400, { error: 'nome invalido' })
  const key = `prints/${name}`

  if (request.method === 'GET') {
    const object = await s3.send(new GetObjectCommand({ Bucket: env.BUCKET, Key: key })).catch((error) => {
      if (error.name === 'NoSuchKey') return null
      throw error
    })
    if (!object) return send(response, 404, { error: 'print nao encontrado' })
    response.writeHead(200, { 'Content-Type': object.ContentType ?? 'application/octet-stream', 'Cache-Control': 'private, max-age=300' })
    object.Body.pipe(response)
    return undefined
  }

  if (request.method === 'DELETE') {
    await s3.send(new DeleteObjectCommand({ Bucket: env.BUCKET, Key: key }))
    log('delete_ok', { key })
    return send(response, 204)
  }

  return send(response, 405, { error: 'metodo nao permitido' })
}
