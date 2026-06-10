import { greet } from '@puzzle-engine/shared'
import { cors } from '@elysia/cors'
import { openapi } from '@elysia/openapi'
import { Elysia } from 'elysia'

const app = new Elysia()
  .use(cors())
  .use(openapi({
    documentation: {
      info: {
        title: 'Puzzle Engine API',
        version: '0.0.1',
      },
    },
  }))
  .get('/', () => greet('Elysia'))

export type App = typeof app
export default app

app.listen(3000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
