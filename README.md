# Excuse

> 让想象力拥有生产力。

基于 Bun + Elysia + React 的全栈应用。

## 技术栈

- **Runtime**: [Bun](https://bun.sh)
- **Server**: [Elysia](https://elysiajs.com) (Type-safe HTTP framework)
- **Client**: [React](https://react.dev) + [Vite](https://vite.dev) + [Tailwind CSS](https://tailwindcss.com)
- **Database**: PostgreSQL + [Drizzle ORM](https://orm.drizzle.team)
- **类型安全通信**: [@elysia/eden](https://elysiajs.com/eden/overview)

## 项目结构

```
excuse/
├── apps/
│   ├── client/     React 前端 (Vite)
│   └── server/     Elysia 后端
├── packages/
│   ├── db/         数据库 Schema + Drizzle 配置
│   └── shared/     前后端共享类型与工具
└── scripts/        脚本工具
```

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发环境（server + client）
bun run dev
```

## 脚本

| 命令 | 说明 |
|------|------|
| `bun run dev` | 同时启动前后端开发服务器 |
| `bun run build` | 构建前后端 |
| `bun run lint` | ESLint 检查 |

## License

[MIT](./LICENSE)
