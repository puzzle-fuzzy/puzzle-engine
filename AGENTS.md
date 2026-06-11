# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Project Overview

AI content generation platform ("让想象力拥有生产力") — Bun monorepo with React frontend, ElysiaJS backend, and a background task worker. All AI calls go through Alibaba DashScope (Qwen text/image, Wan/HappyHorse video). Includes a Canvas pipeline for automated story-to-video generation.

## Common Commands

```bash
# Development (starts server :5007 + client :8007 + worker)
bun run dev

# Individual dev servers
bun run dev:server    # apps/server — Elysia API
bun run dev:client    # apps/client — Vite React SPA
bun run dev:worker    # apps/worker — video task poller

# Build
bun run build

# Testing
bun run test            # bun test (server, worker, billing, provider, shared)
bun run test:client     # vitest (client)
bun run test:all        # both
bun run test:isolate    # bun test with --isolate flag
bun run test:coverage   # both with --coverage

# Run a single bun test file
bun test apps/server/test/auth-routes.test.ts
bun test packages/billing/test/calculate.test.ts

# Run a single vitest test (from apps/client)
cd apps/client && bun vitest src/__tests__/some.test.tsx

# Lint
bun run lint
bun run lint:fix

# Database (from packages/db)
cd packages/db
bun run db:generate     # generate migration from schema changes
bun run db:migrate      # run migrations
bun run db:push         # push schema directly (dev only)
bun run db:studio       # Drizzle Studio GUI

# PostgreSQL (Docker)
docker compose up -d    # starts PG on host port 5433
```

## Architecture

### Monorepo Layout

```
apps/
  client/   — React 19 + Vite + Tailwind CSS 4 + shadcn/ui (port 8007)
  server/   — ElysiaJS API (port 5007)
  worker/   — Background poller for async video tasks
packages/
  db/       — Drizzle ORM schema + repository functions (PostgreSQL 16)
  provider/ — DashScope API client + Aliyun OSS / local file storage
  billing/  — Cost calculation (token/image/video-second) + statistics
  shared/   — Cross-app types + Pino logger singleton
```

**Dependency flow**: `shared` ← `db`, `provider`, `billing` ← apps

### Key Architectural Patterns

**Declarative model config** — All AI models are declared in `packages/provider/src/model-configs.ts` with their parameters, endpoints, input mappings, and pricing. Shared mapping fragments (`TEXT_MAPPING`, `IMAGE_MAPPING`, `VIDEO_T2V_MAPPING`) reduce repetition. `DashScopeClient` has zero model-specific branches — `applyMappings()` routes each param based on its `InputMapping` discriminated union (`prompt | parameter | media | mediaField | ignored`), then `buildRequestBody()` switches on `requestType` to shape the final payload.

**Type derivation chain** — Drizzle schema → `InferSelectModel` → `Serialize` (Date→string) → API types. Types flow one direction from DB schema to API, no duplication.

**Eden treaty** — Client imports server `App` type via `@elysia/eden` for end-to-end type-safe API calls. `unwrapEden<T>()` helper in `apps/client/src/api/client.ts` extracts `data` from Eden's `{ data, error }` response. No separate API client definitions.

**Repository pattern** — DB access through exported async functions in `packages/db/src/repositories/` (not classes). Every function calls `getDb()` → Drizzle query builder → returns nullable single record or array. `getDb()`/`setDb()` singleton for test injection.

**Factory routes** — Most route groups use `export function createXxxRoutes(config: ServerConfig)` returning a scoped `Elysia()` instance. Simpler routes (health, models) export a plain `new Elysia()` directly.

**Async video pipeline** — Server submits video task to DashScope (with `X-DashScope-Async: enable` header) → worker polls every 5s → downloads result → uploads to storage → updates DB → notifies via SSE.

**Canvas pipeline** — Story-to-video generation: analyze text → extract characters/locations → generate references → create storyboard → build prompts → generate videos. All canvas endpoints use `fireAndForget` — immediately return `{ success: true }` and push SSE events as background tasks complete. Worker checks if all project shots are done to auto-mark project complete.

**SSE via PostgreSQL LISTEN/NOTIFY** — `AsyncChannel` bridges PostgreSQL push events into Elysia's pull-based `sse()` generator at `/api/sse?token=<jwt>`. 30-second heartbeat. Client `SSEClient` class in `apps/client/src/api/sse.ts` uses native `EventSource` with typed event handlers and auto-reconnect.

### Server Route Structure

All routes are under `/api`:
- `/api/auth/*` — register, login, me (JWT via `@elysia/jwt`, bcrypt via `Bun.password`)
- `/api/health` — health check
- `/api/models` — list supported models
- `/api/generate` — submit generation task (text/image/video)
- `/api/records` — CRUD for generation records + retry/cancel
- `/api/upload` — multipart file upload + delete
- `/api/canvas/*` — Canvas CRUD + pipeline step endpoints (analyze, characters, locations, refs, storyboard, continuity, rebuild-prompts, generate-videos) + PATCH/DELETE for sub-resources
- `/api/sse` — SSE event stream
- `/api/billing/statistics` — cost stats
- `/api/docs` + `/api/swagger` — Swagger UI

**Auth middleware** — `createAuthPlugin(config)` returns `(app) => app.use(bearer()).use(jwt({...})).derive(...)`. Each route group calls `.use(createAuthPlugin(config))` independently (not globally) to propagate Elysia's `derive` types. Derives nullable `userId: string | null`; routes check manually.

### Database

**9 schema files** in `packages/db/src/schema/`, barrel-exported from `index.ts`:

| Table | Purpose |
|-------|---------|
| `accounts` | Users with username, email, hashed password, avatar |
| `generation_records` | AI generation tasks with JSONB `inputParams`/`outputResult`/`cost`, deduplication by `dedupeKey` |
| `canvas_projects` | Canvas projects with status enum (12 states), analysis/layout JSON |
| `canvas_characters` | Extracted characters per project |
| `canvas_locations` | Extracted locations per project |
| `canvas_shots` | Storyboard shots with status, prompt, video URL |
| `canvas_continuity` | Continuity data between shots |
| `uploaded_files` | File upload tracking |

Uses pgEnum for `category` (text/image/video/audio), `status` (pending/processing/succeeded/failed), and canvas-specific statuses. Drizzle config at `packages/db/drizzle.config.ts` defaults to `localhost:5433`.

### Billing

Cents-based arithmetic with `currency.js` (`precision: 4`). Three calculation units:
- **Token**: inputTokens × price/1M + outputTokens × price/1M
- **Image**: count × price (respects `params.n`)
- **Video**: duration × price (720P vs 1080P by `params.resolution`)

`aggregateStatistics()` computes total/today/week/month costs, breakdown by category and model, 30-day daily trend.

### Client Structure

React Router v6 routes: `/login`, `/register`, `/` (Workspace), `/canvas`, `/canvas/:projectId` (CanvasEditor), `/assets`, `/billing`. All authenticated routes wrapped in `ProtectedRoute` guard. SSE connection established on mount when token exists.

### Environment

Required env vars: `DATABASE_URL`, `DASHSCOPE_API_KEY`, `JWT_SECRET`. Optional: `OSS_*` for Aliyun OSS (falls back to local filesystem). See `.env` for full list.

## Conventions

- **Runtime**: Bun everywhere (package manager, test runner, script execution)
- **Linting**: `@antfu/eslint-config` with React + TypeScript — handles formatting (no Prettier)
- **TypeScript**: Strict mode, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`
- **Logging**: Pino with redaction for sensitive fields. Use the shared logger from `@excuse/shared`.
- **Client API calls**: Use Eden treaty instance from `src/api/client.ts` — never hand-write fetch calls.
- **Client components**: shadcn/ui (Radix primitives). Tailwind CSS v4. Path alias `@/*` → `./src/*`.
- **Testing**: Server tests use `@elysia/eden` `treaty<App>()` for type-safe API testing against minimal Elysia instances. Worker accepts `deps` override for dependency injection.
