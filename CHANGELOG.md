# Changelog

All notable changes to this project will be documented in this file.

## [0.0.1] - 2026-06-11

### Added

- 初始化 Bun monorepo 工作区（apps/* + packages/*）
- **apps/server**: ElysiaJS 后端 API，支持文本/图像/视频生成
- **apps/client**: React 19 + Vite + Tailwind CSS 4 + shadcn/ui 前端 SPA
- **apps/worker**: 后台视频任务轮询器，支持优雅退出
- **packages/db**: Drizzle ORM Schema（accounts、generation_records、uploaded_files）+ Repository 函数
- **packages/provider**: DashScope API 统一客户端 + 阿里云 OSS / 本地双模式存储
- **packages/billing**: 按 Token / 图像 / 视频秒数计费 + 多维度统计
- **packages/shared**: 跨应用类型定义 + Pino Logger 单例
- 用户认证系统：注册、登录、JWT 鉴权（bcrypt 密码哈希）
- 声明式模型配置架构：14 个 AI 模型参数 / 端点 / 定价统一声明，客户端零分支
- 前端媒体上传控件 + r2v 参考图布局
- 生成记录增删查改 + 媒体预览
- 费用统计 API + 前端页面
- 集成 Pino 结构化日志（HTTP 请求日志 + 敏感字段脱敏）
- Docker Compose PostgreSQL 16 开发环境
- 类型安全的 API 通信：`@elysia/eden` treaty 模式
- 后端 CORS + OpenAPI 插件
- ESLint 配置（`@antfu/eslint-config` + React 支持）

### Testing

- 后端测试：bun test + @elysia/eden treaty 模式，覆盖 auth/generate/billing/models 路由
- Worker 测试：config + task-processor（16 tests, 42 assertions）
- Packages 测试：billing、provider、shared 单元测试
- 前端测试：vitest + @testing-library/react + @testing-library/jest-dom
- 测试覆盖率配置（bunfig.toml）

### Changed

- 项目从 "puzzle-engine" 统一品牌更名为 "Excuse"
- 数据库测试从 Proxy mock 改为真实 PostgreSQL
- 使用 Drizzle `InferSelectModel` 推导类型，消除重复定义
- 后端测试文件从 `src/index.test.ts` 迁移至 `test/` 目录
- 后端 `src/index.ts` 导出 `App` 类型，供 Eden 测试和前端类型推导

### Fixed

- 修复百炼 API 参数映射（声明式 inputMapping 替代硬编码分支）
- 修复视频生成后 URL 丢失问题
- 修复 `dev:server` 和 `dev:client` 脚本指向正确的 workspace
- 修复 `concurrently` 命令参数顺序
- 修复 `@excuse/shared` 包 TypeScript 模块解析（添加 `exports` 字段）
- 修复 `kill-ports` 脚本跨平台兼容（Windows + macOS）
