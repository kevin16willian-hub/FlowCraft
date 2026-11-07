import * as oidc from 'openid-client'
import { env } from './env.js'

export const CALLBACK_PATH = '/api/auth/callback/microsoft'
export const REDIRECT_URI = `${env.APP_URL}${CALLBACK_PATH}`

let config
export const getOidcConfig = async () => {
  config ??= await oidc.discovery(
    new URL(`https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/v2.0`),
    env.AZURE_CLIENT_ID,
    env.AZURE_CLIENT_SECRET,
  )
  return config
}
