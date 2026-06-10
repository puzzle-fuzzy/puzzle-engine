import { greet } from '@puzzle-engine/shared'
import { Elysia } from 'elysia'

const app = new Elysia()
  .get('/', () => greet('Elysia'))
  .listen(3000)

console.log(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`,
)
