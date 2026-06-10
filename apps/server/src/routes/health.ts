import { Elysia } from 'elysia'

export const healthRoutes = new Elysia({ prefix: '/api/health' })
  .get('/', () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }))
