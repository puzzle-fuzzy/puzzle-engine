# 项目对比分析：excuse vs angry-mushroom

> 分析日期：2026-06-11
> 对比项目：`g:\excuse` vs `E:\palyground\angry-mushroom`

两者都是 Bun monorepo + ElysiaJS + React 19 + Drizzle + DashScope 的技术栈，但架构和实现质量差异明显。

---

## 我们做得好的地方

### 1. 架构分层更清晰

- 三进程架构：server / client / worker 各自独立，worker 单独轮询视频任务，不占用 server 资源
- angry-mushroom 把视频轮询放在 server 进程内（`startVideoPoller()`），和 HTTP 服务耦合

### 2. 实时推送优于轮询

- PostgreSQL NOTIFY → SSE 链路，视频完成时主动推送到浏览器
- angry-mushroom 前端用 `setInterval` 每 5 秒轮询，浪费带宽、延迟更高

### 3. 认证系统完备

- JWT + bcrypt（Bun 内置）、Bearer + query token 双模式（SSE 场景无法设 header）
- angry-mushroom **没有认证**，任何人可直接访问所有 API

### 4. 声明式模型配置，零分支

- `model-configs.ts` 用 `inputMapping` + `requestType` 声明式描述，DashScopeClient 完全无 `if/else` 分支
- angry-mushroom 的 `BailianClient` 内部按模型类型做条件分支，扩展新模型需要改客户端代码

### 5. 端到端类型安全

- Eden Treaty 让前端直接获得 server 路由的完整类型推导，`App` 类型一键导入
- angry-mushroom 手写 `api.ts` 逐个路由映射，容易遗漏或类型不一致

### 6. 测试体系完整

- 20+ 测试文件覆盖 server/worker/db/client，worker 用依赖注入（`TaskProcessorDeps`），DB 测试用真实 PostgreSQL + ROLLBACK
- angry-mushroom **完全没有测试**

### 7. 日志与可观测性

- Pino 结构化日志，自动脱敏（password/token/apiKey 等字段 redact）
- angry-mushroom 用 `console.log`，无结构化、无脱敏

### 8. 工程规范

- ESLint (@antfu config)、`verbatimModuleSyntax`、`noUncheckedIndexedAccess`
- Worker 优雅退出（SIGINT/SIGTERM + segmented sleep）、4h stale task 自动标记失败
- angry-mushroom 无 lint、无优雅退出、无 stale 处理

### 9. 数据库选型

- PostgreSQL：支持 NOTIFY/LISTEN、jsonb、并发写入，docker-compose 一键启动
- angry-mushroom 用 SQLite：单写锁、不支持 NOTIFY，扩展性受限

---

## 我们做得不好的地方

### 1. 业务域深度不足

- excuse 只有 3 张表（accounts、generation_records、uploaded_files），功能限于「选模型 → 生成 → 看记录」
- angry-mushroom 有 **8 张表**，实现了完整的「小说 → 分析 → 角色 → 场景 → 分镜 → 连续性检查 → 视频生成」6 步流水线，这是产品的核心价值

### 2. 前端交互体验差距大

- excuse 的 Workspace 页面只是简单的表单 + 列表
- angry-mushroom 有：PromptEditor（@mention 富文本编辑器）、ReferenceUploadZone（拖拽上传）、Explore 页面 6 步工作流 UI（每步独立状态、锁定角色/场景、自动生成模式）

### 3. 缺少领域特定逻辑

- excuse 没有连续性检查（180 度规则、禁止角度、角色朝向一致性）
- angry-mushroom 有 `continuity.ts` 实现确定性验证规则，这是视频生成质量的关键

### 4. 缺少 prompt 构建体系

- excuse 把用户输入直接传给 DashScope
- angry-mushroom 有 `prompt-builder.ts` + `prompts/` 目录，将角色身份、场景设定、镜头语言、连续性约束组合成结构化英文 prompt + negative prompt

### 5. 没有 fallback 机制

- excuse 视频生成失败就失败了
- angry-mushroom 在 r2v（参考图生成视频）失败时自动 fallback 到 t2v（纯文本生成视频）

### 6. 缺少 API 文档

- excuse 没有生成 OpenAPI/Swagger 文档的配置
- angry-mushroom 用 `@elysiajs/openapi` 自动生成，开发者可在线浏览所有路由

### 7. 缺少 Mapper 层

- excuse 直接返回 Drizzle 查询结果（含 Date 类型需要 Serialize）
- angry-mushroom 有专门的 `mapper.ts` 将 DB 行（含 JSON 字符串列）转为干净类型接口，带 try/catch fallback

---

## 总结

| 维度 | excuse | angry-mushroom |
|------|--------|----------------|
| 架构/工程 | **明显更强**（3进程、NOTIFY/SSE、DI、测试、日志、lint） | 较弱（无认证、无测试、无 lint、polling） |
| 业务/产品 | **明显较弱**（3表、简单CRUD、无流水线） | **明显更强**（8表、6步流水线、连续性检查、prompt体系） |

**核心结论：我们的工程底座扎实，但业务骨架空洞；他们的业务骨架丰满，但工程底座脆弱。**

下一步应该把 angry-mushroom 的领域逻辑（流水线、连续性检查、prompt 构建、角色/场景管理）迁移到我们的工程架构上来——这才是两者结合后的最优路径。