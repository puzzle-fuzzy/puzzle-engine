import { cors } from '@elysia/cors'
import { Elysia } from 'elysia'
import { staticPlugin } from '@elysia/static'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { loadConfig } from './config'
import { healthRoutes } from './routes/health'
import { modelsRoutes } from './routes/models'
import { createGenerateRoutes } from './routes/generate'
import { createUploadRoutes } from './routes/upload'
import { billingRoutes } from './routes/billing'

const config = loadConfig()

// 确保 uploads 目录存在
const uploadsDir = join(import.meta.dir, '..', config.storageRoot)
mkdirSync(uploadsDir, { recursive: true })

const app = new Elysia()
  .use(cors({
    origin: [config.frontendUrl, 'http://localhost:8007'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))
  .use(staticPlugin({
    assets: uploadsDir,
    prefix: '/api/uploads',
  }))
  .use(healthRoutes)
  .use(modelsRoutes)
  .use(createGenerateRoutes(config))
  .use(createUploadRoutes(config))
  .use(billingRoutes)

export type App = typeof app
export default app

app.listen(config.port)

console.log(
  `🦊 Excuse API is running at ${app.server?.hostname}:${app.server?.port}`,
)
