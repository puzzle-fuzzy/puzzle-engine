# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- 前端单元测试：vitest + @testing-library/react + @testing-library/jest-dom
- 后端测试使用 @elysia/eden treaty 模式，测试文件统一到 `test/` 目录
- 后端添加 @elysia/cors 和 @elysia/openapi 插件
- @excuse/shared 包添加 `exports` 字段，修复 TypeScript 模块解析
- ESLint 配置切换为 @antfu/eslint-config（含 React 支持）

### Changed

- 后端测试文件从 `src/index.test.ts` 移至 `test/index.test.ts`
- 后端 `src/index.ts` 导出 `App` 类型及 `app` 默认导出，供 Eden 测试使用
- 前端 package.json 添加 `test` script（vitest）

### Fixed

- 修复 `dev:server` 和 `dev:client` 脚本指向正确的 workspace
- 修复 `concurrently` 命令：添加 `--prefix-colors`，`--kill-others-on-fail` 移至末尾