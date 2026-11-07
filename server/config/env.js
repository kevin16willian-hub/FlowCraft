import { randomBytes } from 'node:crypto'
import { join } from 'node:path'

try { process.loadEnvFile() } catch { /* sem .env: usa o ambiente do processo */ }

const { AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID, S3_BUCKET } = process.env

if (!S3_BUCKET || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_TENANT_ID) {
  console.error('S3_BUCKET e AZURE_* sao obrigatorios')
  process.exit(1)
}
if (!process.env.DB_SERVER || !process.env.DB_DATABASE || !process.env.DB_USERNAME || !process.env.DB_PASSWORD) {
  console.error('DB_SERVER, DB_DATABASE, DB_USERNAME e DB_PASSWORD sao obrigatorios')
  process.exit(1)
}
if (!process.env.SESSION_SECRET) console.warn('SESSION_SECRET nao definido; sessoes sao perdidas ao reiniciar')

const APP_URL = (process.env.APP_URL ?? 'https://flowcraft.straumann.com').replace(/\/$/, '')

export const env = {
  PORT: Number(process.env.PORT ?? 3004),
  HOST: process.env.HOST ?? '127.0.0.1',
  BUCKET: S3_BUCKET,
  REGION: process.env.AWS_REGION ?? 'sa-east-1',
  MAX_BYTES: 1024 * 1024,
  MAX_JSON_BYTES: 8 * 1024 * 1024,
  DIST: join(process.cwd(), 'dist'),
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  AZURE_TENANT_ID,
  APP_URL,
  SECURE: APP_URL.startsWith('https'),
  DB_SERVER: process.env.DB_SERVER,
  DB_DATABASE: process.env.DB_DATABASE,
  DB_USERNAME: process.env.DB_USERNAME,
  DB_PASSWORD: process.env.DB_PASSWORD,
  SESSION_SECRET: process.env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
  SESSION_TTL: 8 * 60 * 60,
}
