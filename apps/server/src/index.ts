import { cors } from '@elysia/cors'
import { Elysia } from 'elysia'
import { staticPlugin } from '@elysia/static'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'
import { logger } from '@excuse/shared'
import { loadConfig } from './config'
import { loggerPlugin } from './plugins/logger'
import { createAuthPlugin } from './plugins/auth'
import { createAuthRoutes } from './routes/auth'
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
  .use(loggerPlugin)
  .use(cors({
    origin: [config.frontendUrl, 'http://localhost:8007'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }))
  .use(staticPlugin({
    assets: uploadsDir,
    prefix: '/api/uploads',
  }))
  .use(createAuthPlugin(config))
  .use(createAuthRoutes(config))
  .use(healthRoutes)
  .use(modelsRoutes)
  .use(createGenerateRoutes(config))
  .use(createUploadRoutes(config))
  .use(billingRoutes)

export type App = typeof app
export default app

app.listen(config.port)

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  '🦊 Excuse API is running',
)
