import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const processPrintsDirectory = join(process.cwd(), 'public', 'process-prints', 'uploads')

const localPrintStorage = (): Plugin => ({
  name: 'local-process-print-storage',
  configureServer(server) {
    server.middlewares.use('/api/process-prints', (request, response) => {
      if (!existsSync(processPrintsDirectory)) mkdirSync(processPrintsDirectory, { recursive: true })

      if (request.method === 'DELETE') {
        const filename = basename(request.url ?? '')
        const printPath = join(processPrintsDirectory, filename)
        if (filename && existsSync(printPath)) unlinkSync(printPath)
        response.statusCode = 204
        response.end()
        return
      }

      const chunks: Buffer[] = []
      request.on('data', (chunk) => chunks.push(chunk as Buffer))
      request.on('end', () => {
        const contentType = request.headers['content-type']
        const extension = contentType === 'image/png' ? '.png' : contentType === 'image/jpeg' ? '.jpg' : contentType === 'image/webp' ? '.webp' : '.png'
        const filename = `print-${Date.now()}${extension}`
        writeFileSync(join(processPrintsDirectory, filename), Buffer.concat(chunks))
        response.setHeader('Content-Type', 'application/json')
        response.end(JSON.stringify({ url: `/process-prints/uploads/${filename}`, name: filename }))
      })
    })
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localPrintStorage()],
  server: { proxy: { '/api': 'http://127.0.0.1:3004' } },
})
