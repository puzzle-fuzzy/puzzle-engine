import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { cors } from '@elysia/cors'
import { staticPlugin } from '@elysia/static'
import { openapi } from '@elysiajs/openapi'
import { swagger } from '@elysiajs/swagger'
import { logger } from '@excuse/shared'
import { Elysia } from 'elysia'
import { loadConfig } from './config'
import { createAuthPlugin } from './plugins/auth'
import { loggerPlugin } from './plugins/logger'
import { createAuthRoutes } from './routes/auth'
import { createBillingRoutes } from './routes/billing'
import { createCanvasRoutes } from './routes/canvas'
import { createGenerateRoutes } from './routes/generate'
import { healthRoutes } from './routes/health'
import { modelsRoutes } from './routes/models'
import { createSSERoutes } from './routes/sse'
import { createUploadRoutes } from './routes/upload'
import { startSSEListener } from './services/sse-manager'

const config = loadConfig()

// 确保 uploads 目录存在
const uploadsDir = join(import.meta.dir, '..', config.storageRoot)
mkdirSync(uploadsDir, { recursive: true })

const app = new Elysia()
  .use(openapi({
    documentation: {
      info: {
        title: 'Excuse API',
        version: '0.1.0',
        description: 'AI 内容生成平台 — 创意流水线 API 文档',
      },
    },
    path: '/api/docs',
  }))
  .use(swagger({
    path: '/api/swagger',
    documentation: {
      info: {
        title: 'Excuse API',
        version: '0.1.0',
        description: 'AI 内容生成平台 — 创意流水线 API 文档',
      },
    },
  }))
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
  .use(createCanvasRoutes(config))
  .use(createGenerateRoutes(config))
  .use(createUploadRoutes(config))
  .use(createSSERoutes(config))
  .use(createBillingRoutes(config))

export type App = typeof app
export default app

app.listen(config.port)

// 启动 PostgreSQL LISTEN — 接收 Worker 的生成状态通知并推送到 SSE 客户端
startSSEListener().catch((err: any) => {
  const code = err?.aggregateErrors?.[0]?.code || err?.code
  if (code === 'ECONNREFUSED') {
    logger.error('❌ PostgreSQL 未启动（连接被拒绝），请检查数据库服务')
  }
  else {
    logger.error({ err }, 'Failed to start SSE listener')
  }
})

logger.info(
  { host: app.server?.hostname, port: app.server?.port },
  '🦊 Excuse API is running',
)
