import { S3Client } from '@aws-sdk/client-s3'
import { env } from './env.js'

export const s3 = new S3Client({ region: env.REGION })
