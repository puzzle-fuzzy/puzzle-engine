# Excuse

> 让想象力拥有生产力

基于 Bun + ElysiaJS + React 的全栈 AI 内容生成平台，集成阿里云百炼（DashScope）多模态模型，支持文本、图像、视频生成。

## 技术栈

- **Runtime**: [Bun](https://bun.sh)
- **Server**: [ElysiaJS](https://elysiajs.com) — 类型安全的 HTTP 框架
- **Client**: [React 19](https://react.dev) + [Vite](https://vite.dev) + [Tailwind CSS 4](https://tailwindcss.com) + [shadcn/ui](https://ui.shadcn.com)
- **Database**: [PostgreSQL 16](https://www.postgresql.org) + [Drizzle ORM](https://orm.drizzle.team)
- **AI Provider**: 阿里云百炼 / DashScope（通义千问文本、通义万相图像、Wan 2.7 / HappyHorse 视频）
- **Storage**: 阿里云 OSS（可选，默认本地文件系统）
- **类型安全通信**: [@elysia/eden](https://elysiajs.com/eden/overview) treaty 模式
- **Auth**: JWT + bcrypt
- **Logging**: [Pino](https://getpino.io) 结构化日志 + 脱敏

## 项目结构

```
excuse/
├── apps/
│   ├── client/     React 前端 SPA (Vite, shadcn/ui)
│   ├── server/     ElysiaJS 后端 API
│   └── worker/     后台任务轮询（异步视频生成）
├── packages/
│   ├── db/         Drizzle ORM Schema + Repository 函数
│   ├── provider/   DashScope API 客户端 + OSS/本地存储
│   ├── billing/    费用计算（Token/图像/视频秒数）+ 统计
│   └── shared/     跨应用类型定义 + Pino Logger
├── scripts/        脚本工具
└── docs/           文档
```

## 快速开始

```bash
# 安装依赖
bun install

# 启动 PostgreSQL
docker compose up -d

# 配置环境变量
cp .env.example .env
# 编辑 .env 填入 DASHSCOPE_API_KEY、JWT_SECRET 等

# 运行数据库迁移
cd packages/db && bun run db:migrate && cd ../..

# 启动开发环境（server + client + worker）
bun run dev
```

- 前端访问: http://localhost:8007
- 后端 API: http://localhost:5007/api

## 脚本

| 命令 | 说明 |
|------|------|
| `bun run dev` | 同时启动 server + client + worker |
| `bun run dev:server` | 仅启动后端 |
| `bun run dev:client` | 仅启动前端 |
| `bun run dev:worker` | 仅启动 worker |
| `bun run build` | 构建前后端 |
| `bun run test` | Bun 测试（server, worker, packages） |
| `bun run test:client` | Vitest 前端测试 |
| `bun run test:all` | 运行全部测试 |
| `bun run test:coverage` | 测试覆盖率 |
| `bun run lint` | ESLint 检查 |
| `bun run lint:fix` | ESLint 自动修复 |

### 数据库命令（在 `packages/db` 目录下）

| 命令 | 说明 |
|------|------|
| `bun run db:generate` | 根据 Schema 变更生成迁移文件 |
| `bun run db:migrate` | 执行迁移 |
| `bun run db:push` | 直接推送 Schema（仅开发环境） |
| `bun run db:studio` | 打开 Drizzle Studio GUI |

## License

[MIT](./LICENSE)
