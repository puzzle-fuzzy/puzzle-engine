# Excuse 项目改进规划

> 基于 Puzzle-Bobble 项目对比分析，取其精华去其糟粕，制定可落地的改进清单。

---

## 一、我们做得好的（保持优势，不盲目改）

这些方面 Excuse 已领先，无需照搬 Puzzle-Bobble：

| 方面 | Excuse 优势 | Puzzle-Bobble 做法 | 结论 |
|------|-------------|---------------------|------|
| 运行时 | Bun（内置密码哈希、测试、快启动） | Node.js + 外部依赖 | 保持 Bun，不降级 |
| 模型配置 | `inputMapping` + `requestType` 声明式映射，新增模型只改数据 | 硬编码 model-catalog-data，需写分支逻辑 | 保持声明式，可进一步抽象为 DB 存储的 catalog |
| 类型安全 | Eden Treaty 全链路类型推导（App → client） | 手写 fetch wrapper + 手动类型同步 | 保持 Eden，不换成手写 |
| UI 组件 | shadcn/ui + Tailwind 4 + Radix（生产级、可访问） | 自定义 CSS 变量 + 手写组件 | 保持 shadcn 体系 |
| 存储策略 | 先本地后 OSS，OSS 失败回退本地 URL | local + OSS 但无兜底 | 保持双写兜底 |
| 错误映射 | 60+ DashScope 错误码 → 中文提示 | 通用 AppError 体系 | 保持精细化映射 |
| 日志安全 | Pino redact（password/token/apiKey） | 自建 logger 无 redact | 保持 Pino + redact |
| 服务风格 | 纯函数式 service（无 DI 框架，简洁） | 同样是纯函数式 service | 两者一致，保持 |

---

## 二、必须参照改进的（P0 — 商业化/安全底线）

### 2.1 计费生命周期 Reserve → Debit → Refund

**Puzzle-Bobble 做法：**
- 三阶段闭环：Reserve（预扣锁定额度）→ Debit（结算实际费用）→ Refund（失败/取消退款）
- `SELECT FOR UPDATE` 行锁防并发竞态（同一账户同时请求不会超额）
- 所有金额用**整数分**（CNY cents），避免浮点误差，上限 20M CNY
- 唯一索引防双扣/双退：creditTransactions 的 `(taskId, type)` unique
- creditAccounts 表存余额 + locked（预扣冻结），creditTransactions 表存流水

**我们要做的：**
- [ ] 新增 `credit_accounts` 表：accountId, balance(分), locked(分), createdAt, updatedAt
- [ ] 新增 `credit_transactions` 表：id, accountId, taskId, type(reserve/debit/refund/grant/adjust), amount(分), createdAt，唯一索引 `(taskId, type)`
- [ ] 新增 `usage_events` 表：id, accountId, taskId, model, inputTokens, outputTokens, duration, cost(分), createdAt
- [ ] `@excuse/billing` 包重构：
  - `doReserve(db, accountId, taskId, estimatedCostCents)` — SELECT FOR UPDATE 行锁 + 扣 locked
  - `doDebit(db, accountId, taskId, actualCostCents)` — 解 locked + 扣 balance，差额自动退款
  - `doRefund(db, accountId, taskId)` — 释放 locked 回 balance
  - `doGrant(db, accountId, amountCents)` — 管理员充值
- [ ] 前端 Billing 页面展示：余额、冻结额度、30 日消费趋势
- [ ] 所有金额运算统一为整数分，严禁 float

### 2.2 速率限制

**Puzzle-Bobble 做法：**
- 三层内存 rate limiting（全局限流、per-user 限流、per-API-key 限流）
- Hono middleware 实现，基于 IP/userId/key

**我们要做的：**
- [ ] `@excuse/server` 新增 rate-limit plugin：
  - 全局：每分钟 N 次总请求
  - per-user：每分钟 M 次（按 userId）
  - per-model：敏感模型单独限流（如视频生成每分钟 2 次）
- [ ] 用 Elysia middleware + 内存滑动窗口实现（小规模足够，无需 Redis）
- [ ] 返回 429 + Retry-After header + 中文提示

### 2.3 安全加固 — ESLint 规则

**Puzzle-Bobble 做法：**
- `no-console` 强制使用 logger（避免 console.log 泄漏敏感信息到 stdout）
- `no-explicit-any` 在计费相关代码中作为 error
- `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` 严格 TS 选项

**我们要做的：**
- [ ] ESLint 新增规则：`no-console`（error 级别，必须用 `@excuse/shared` logger）
- [ ] ESLint 新增规则：`@typescript-eslint/no-explicit-any`（billing 包内 error 级别）
- [ ] tsconfig 开启 `noUncheckedIndexedAccess`（数组/对象索引返回 `T | undefined`）
- [ ] tsconfig 开启 `exactOptionalPropertyTypes`（可选属性不能显式赋 undefined）

---

## 三、重要参照改进的（P1 — 多租户/合规/部署）

### 3.1 API Key + 客户管理体系

**Puzzle-Bobble 做法：**
- `customers` 表与 `users` 表分离（users = 内部运营，customers = 外部客户）
- API Key 前缀 `lmk_`，SHA-256 哈希存储，只存前 8 字符用于辨识
- 管理后台 CRUD 客户、分配额度、查看使用量
- 支持 JWT Bearer 和 API Key `lmk_` 前缀两种认证方式

**我们要做的：**
- [ ] 新增 `api_keys` 表：id, accountId, prefix(lmk_), keyHash(SHA-256), name, createdAt, expiresAt, lastUsedAt
- [ ] 认证 plugin 扩展：支持 `Authorization: Bearer <jwt>` 和 `Authorization: Bearer lmk_xxx` 双模式
- [ ] 路由：`POST /api/api-keys` 创建、`GET /api/api-keys` 列表、`DELETE /api/api-keys/:id` 删除
- [ ] API Key 创建时返回完整密钥（仅此一次），之后只存哈希
- [ ] 前端 Settings 页面新增 API Key 管理面板

### 3.2 审计日志

**Puzzle-Bobble 做法：**
- `audit_logs` 表：who(userId), what(action), on(targetType+targetId), result, metadata(jsonb), createdAt
- `writeAuditLog(db, { actor, action, target, result, metadata })` 函数
- 记录：登录/登出、创建项目、计费操作、API Key 创建/删除、管理员操作

**我们要做的：**
- [ ] 新增 `audit_logs` 表：id, accountId, action, targetType, targetId, result, metadata(jsonb), createdAt
- [ ] `@excuse/db` 新增 `writeAuditLog()` 函数
- [ ] 在关键操作处调用：登录/注册、创建/删除记录、计费 reserve/debit/refund、API Key CRUD
- [ ] 管理端可查询审计日志（按 accountId、action、时间范围筛选）

### 3.3 生产部署方案

**Puzzle-Bobble 做法：**
- Docker 多阶段构建（builder → runtime，含 FFmpeg）
- nginx.conf：TLS、SPA fallback、API 代理、安全 headers（X-Frame-Options, CSP 等）
- docker-compose.prod.yml（postgres + api + worker + web）
- `.env.example` 41+ 变量模板

**我们要做的：**
- [ ] 编写 `Dockerfile`：多阶段构建，builder 阶段 bun install + build，runtime 阶段精简
- [ ] 编写 `nginx.conf`：SPA fallback、/api 代理到后端、安全 headers
- [ ] 编写 `docker-compose.prod.yml`：postgres + server + worker + client
- [ ] 完善 `.env.example`：补齐所有配置项注释
- [ ] Bun 产线兼容性确认：Bun 在 Docker 内运行是否稳定，考虑 Node.js fallback 方案

---

## 四、推荐参照改进的（P2 — 运维/数据安全）

### 4.1 可观测性 — Prometheus Metrics

**Puzzle-Bobble 做法：**
- `/metrics` 端点，Prometheus 格式
- Counter（请求总数、任务完成数）、Gauge（活跃连接数）、Histogram（请求延迟分布）
- Worker 和 API 各有独立 `/metrics` 端口

**我们要做的：**
- [ ] `@excuse/shared` 新增 metrics 模块：Counter / Gauge / Histogram（Prometheus 格式）
- [ ] Server 新增 `/api/metrics` 路由（可选：独立端口 4201 避免暴露在公网）
- [ ] 记录指标：请求总数、请求延迟、生成任务数（按 model/category）、SSE 连接数、错误率
- [ ] Worker 新增 `/metrics` 健康端口

### 4.2 OpenAPI Spec 自动生成

**Puzzle-Bobble 做法：**
- Hono 的 `@hono/zod-openapi` 自动生成 `/api/docs/openapi.json`
- 前端可通过 Swagger UI 浏览 API

**我们要做的：**
- [ ] 研究 Elysia 是否有 OpenAPI 生成能力（Elysia 内置 swagger plugin）
- [ ] 启用 `@elysia/swagger` plugin，自动生成 `/api/docs/swagger`
- [ ] 所有路由的 Zod/Elysia schema 自动映射为 OpenAPI 定义

### 4.3 软删除 + 去重保护

**Puzzle-Bobble 做法：**
- 所有核心表有 `deleted_at` 字段，软删除而非硬删
- 唯一索引防重复操作（creditTransactions taskId+type）
- DedupeKey 在 tasks 表防重复提交

**我们要做的：**
- [ ] `generation_records` 表新增 `deleted_at` 字段
- [ ] `uploaded_files` 表新增 `deleted_at` 字段
- [ ] 删除操作改为 `UPDATE SET deleted_at = NOW()`，查询自动 `WHERE deleted_at IS NULL`
- [ ] 新增去重字段：generation_records 加 `dedupe_key`（model + params hash），防同参数重复提交
- [ ] 唯一索引：credit_transactions `(taskId, type)` 防双扣双退

### 4.4 数据保留策略

**Puzzle-Bobble 做法：**
- `runRetentionCleanup()` 定期清理过期数据（旧审计日志、过期 token、临时记录）
- 启动时自动注册周期任务

**我们要做的：**
- [ ] 定义保留策略：审计日志 90 天、已删除记录 30 天后物理删除、过期 API Key 自动停用
- [ ] Server 启动时注册定期清理任务（每小时执行）
- [ ] `@excuse/db` 新增 `runRetentionCleanup(db)` 函数

### 4.5 DB 健康检查增强

**Puzzle-Bobble 做法：**
- `waitForDb()` 启动时等待 DB 可用（轮询直到连接成功）
- `healthCheck()` 返回 DB 连接状态
- `/api/health` 返回 DB + 各服务状态

**我们要做的：**
- [ ] `@excuse/db` 新增 `waitForDb()` 函数（Server 和 Worker 启动时调用）
- [ ] `/api/health` 返回结构化状态：{ db: "ok", sseConnections: N, uptime: S }
- [ ] Worker 启动时先 waitForDb 再开始轮询

---

## 五、参照 angry-mushroom 改进的（业务域增强）

> 基于 `angry-mushroom` 项目对比分析（详见 `docs/项目对比分析-excuse-vs-angry-mushroom.md`），我们工程底座扎实但业务骨架空洞，以下是从 angry-mushroom 业务侧需要补齐的内容。

### 5.1 小说到视频的 6 步流水线

**angry-mushroom 做法：**
- 8 张表支撑完整流水线：story_projects、story_characters、story_locations、story_shots、story_scenes、continuity_reports、character_references、generation_records
- 6 步顺序工作流：故事输入 → AI 分析（提取角色/场景）→ 角色生成（外貌+身份 prompt）→ 场景生成（视觉规则+场景 prompt）→ 分镜生成（逐秒时间线+镜头方向）→ 连续性检查 → prompt 重建 → 视频生成
- 自动生成模式（`autoGenerate`）：一键跑完全流水线，含参考图生成，步骤间有延迟避免 API 限流

**我们要做的：**
- [ ] 新增 `story_projects` 表：id, accountId, title, storyText, analysisJson, status(draft/analyzing/characters/locations/storyboard/generating/completed), createdAt, updatedAt
- [ ] 新增 `story_characters` 表：id, projectId, name, appearance, identityPrompt, negativePrompt, locked, createdAt
- [ ] 新增 `story_locations` 表：id, projectId, name, sceneProfile(视觉规则：色板/灯光/建筑/摄影规则), scenePrompt, negativePrompt, locked, createdAt
- [ ] 新增 `story_shots` 表：id, projectId, sceneId, shotOrder, timeline(逐秒), cameraDirection, narrative, identityPrompt, negativePrompt, continuityJson, status, dashscopeTaskId, resultUrl, createdAt
- [ ] 新增 `character_references` 表：id, characterId, imageUrl, source(generated/uploaded), createdAt
- [ ] 后端新增 `novel-video` 模块：projects CRUD + 6 步 pipeline 路由
- [ ] 前端新增 `Explore` 页面：6 步工作流 UI，每步独立状态展示，支持锁定角色/场景不被重新生成覆盖

### 5.2 连续性检查系统

**angry-mushroom 做法：**
- `continuity.ts` 实现确定性（非 AI）验证规则，检查分镜间的视觉一致性
- 检查项：缺失场景/角色引用、禁止摄影角度、180 度规则违反（角色朝向突变）、动作/情绪不一致
- 检查结果存入 `continuity_reports` 表

**我们要做的：**
- [ ] 新增 `continuity_reports` 表：id, projectId, shotId, issueType, severity(error/warning), description, suggestion, createdAt
- [ ] `@excuse/server` 新增 `continuity` 服务，实现规则：
  - 角色朝向一致性（180 度规则：同场景连续镜头中角色面朝方向不能翻转）
  - 禁止角度检测（每个场景可定义 forbiddenAngles，分镜中不得违反）
  - 引用完整性（分镜引用的角色/场景必须存在且已生成 prompt）
  - 动作/情绪连续性（连续镜头间角色的动作和情绪应该过渡自然）
- [ ] API：`POST /api/projects/:id/continuity/check`
- [ ] 前端在分镜步骤后展示连续性问题列表，按 severity 着色

### 5.3 Prompt 构建体系

**angry-mushroom 做法：**
- `prompt-builder.ts` 将角色身份 + 场景设定 + 镜头语言 + 连续性约束组合成结构化英文 prompt + negative prompt
- `prompts/` 目录存放各步骤的 system prompt 模板（角色生成、场景生成、分镜生成各有专用 prompt）
- 分镜 prompt 包含严格的画面一致性要求（角色外貌/服装/发色/体型必须一致）

**我们要做的：**
- [ ] 新增 `packages/provider/src/prompts/` 目录，按功能分文件存放 system prompt 模板
- [ ] 新增 `prompt-builder.ts`：组合函数，将角色 identityPrompt + 场景 scenePrompt + 镜头 camera + 连续性约束 → 最终 video prompt
- [ ] 角色 prompt 模板：给定角色名和故事背景，生成外貌、服装、配饰的英文视觉描述
- [ ] 场景 prompt 模板：给定场景名，生成色板、灯光、建筑风格、摄影规则
- [ ] 分镜 prompt 模板：给定角色+场景+故事段落，生成逐秒时间线、镜头运动、景别
- [ ] Negative prompt 体系：每个生成步骤都配套 negative prompt（排除元素、画质要求）

### 5.4 视频生成 Fallback 机制

**angry-mushroom 做法：**
- r2v（参考图生成视频）失败时自动 fallback 到 t2v（纯文本生成视频）
- Worker 层面实现，捕获 r2v 异常后用 t2v 重试

**我们要做的：**
- [ ] `@excuse/provider` 的 DashScopeClient 新增 fallback 配置：`fallbackModel` 字段
- [ ] Worker `task-processor.ts`：视频任务失败时检查是否有 fallbackModel，有则用 fallback 重试
- [ ] `model-configs.ts` 中 r2v 模型声明 fallback 为对应 t2v 模型
- [ ] 生成记录中标记实际使用的模型（可能是 fallback 模型），确保计费准确

### 5.5 前端交互体验提升

**angry-mushroom 做法：**
- `PromptEditor` 组件：支持 @mention 插入角色/场景引用标签的富文本编辑器
- `ReferenceUploadZone` 组件：拖拽上传文件，支持预览和删除
- Explore 页面 6 步工作流：每步卡片式布局，独立状态（pending/processing/completed），角色/场景可锁定，自动生成模式开关

**我们要做的：**
- [ ] Workspace 页面新增 `PromptEditor` 组件：支持 `@` 触发下拉菜单选择角色/场景/镜头，插入引用标签（如 `[Character:小明]`）
- [ ] Workspace 页面新增 `ReferenceUploadZone` 组件：拖拽区域 + 文件预览 + 删除按钮，支持图片/视频文件
- [ ] Explore 页面工作流 UI：卡片式布局，每步有状态指示器（待处理/处理中/完成/失败），支持手动触发和自动模式切换
- [ ] 角色/场景卡片支持锁定（`locked` 状态），重新生成时跳过已锁定项
- [ ] 视频生成记录支持内联预览播放

### 5.6 Mapper 层

**angry-mushroom 做法：**
- `mapper.ts` 将 DB 查询结果（含 JSON 字符串列）转为干净的 TypeScript 接口
- JSON 字段解析带 try/catch fallback，避免损坏数据导致整条记录解析失败

**我们要做的：**
- [ ] `@excuse/db` 新增 `mappers/` 目录，按表分文件（accounts.mapper.ts、generation-records.mapper.ts 等）
- [ ] 每个 mapper 负责处理 JSON 字符串解析、Date 序列化、枚举类型转换
- [ ] JSON 字段解析统一用 try/catch 包裹，失败返回 null 而非抛异常
- [ ] 路由层只使用 mapper 返回的干净类型，不再直接操作 Drizzle row 类型

### 5.7 OpenAPI 文档自动生成

**angry-mushroom 做法：**
- 使用 `@elysiajs/openapi` 自动生成 OpenAPI/Swagger 文档
- 开发者可在 `/api/openapi` 浏览所有路由定义

**我们要做的：**
- [ ] 安装 `@elysiajs/openapi` 插件
- [ ] Server 入口注册 OpenAPI 插件，配置 `/api/docs` 路径
- [ ] 确保所有路由的 Elysia schema（`t.Object` 等）正确映射到 OpenAPI 定义
- [ ] 开发环境可通过 `/api/docs` 在线调试 API

---

## 六、可选参照改进的（P3 — 功能增强）

### 5.1 通知系统

**Puzzle-Bobble 做法：**
- `notifications` 表 + SSE notification 频道
- 类型：余额预警、任务完成、系统公告
- 前端右上角通知铃铛 + 通知列表

**我们要做的：**
- [ ] 新增 `notifications` 表：id, accountId, type, title, content, read, createdAt
- [ ] SSE 新增 `notification` 事件类型
- [ ] 预设通知触发器：余额低于阈值、视频生成完成、API Key 过期预警
- [ ] 前端 Navbar 新增通知图标 + 未读计数 badge + 通知面板

### 5.2 OpenAI 兼容网关

**Puzzle-Bobble 做法：**
- `/api/gateway/v1/chat/completions` 完全兼容 OpenAI API 格式
- 外部工具（Cursor、ChatGPT 客户端等）可直接接入
- 请求转发到 DashScope，响应转译为 OpenAI 格式
- 计费通过 Reserve/Debit 走同一套

**我们要考虑的：**
- [ ] 评估是否需要 OpenAI 兼容层（取决于目标用户是否为开发者）
- [ ] 如果需要：新增 `/api/v1/chat/completions` 路由，请求/响应格式转译
- [ ] 仅支持文本模型（qwen 系列），通过 API Key 认证 + 计费

### 5.3 流水线编排（渐进式）

**Puzzle-Bobble 做法：**
- 12 步流水线：storyKit → script → shot → characterRef → asset → compose
- Worker 自动编排：完成一步后自动触发下一步
- `getNextTaskType()` + `orchestrator.ts` 控制流转

**我们要做的（渐进式）：**
- [ ] 第一阶段：仅支持"一键生图+生视频"组合（文本→图片→视频的简单串联）
- [ ] `@excuse/shared` 新增 pipeline 定义：step sequence + fallback model
- [ ] Worker 扩展：任务完成时检查是否有后续步骤，自动创建下一步任务
- [ ] 前端新增"一键创作"按钮：一键串联 文案→配图→短视频

### 5.4 完善文档

**Puzzle-Bobble 做法：**
- 10+ 篇中文文档：架构设计、API 文档、部署指南、变更日志、编码规范
- TODO.md 53KB 详尽追踪
- CLAUDE.md 给 AI 助手提供项目上下文

**我们要做的：**
- [ ] 重写 `编码规范.md`：补齐 Bun + Elysia + Eden 的编码约定、命名规范、错误处理模式
- [ ] 新写 `部署指南.md`：Docker + nginx 部署步骤
- [ ] 新写 `API 文档.md`：所有路由的请求/响应格式（可从 OpenAPI spec 生成）
- [ ] 更新 `创意流水线架构设计.md`：反映当前实际架构，不是空谈
- [ ] 新写 `CLAUDE.md`：给 AI 助手的项目上下文（关键文件位置、约定、禁止事项）

---

## 七、Puzzle-Bobble 的糟粕（我们不照搬的）

| 做法 | 原因 |
|------|------|
| 自建 logger（@puzzle-bobble/core logger.ts） | Pino 是成熟的、性能更好的日志库，自建 logger 功能更少 |
| 手写 fetch wrapper 做 API client | Eden Treaty 端到端类型安全更优雅，手写容易类型漂移 |
| 自建 UI 组件体系 | shadcn/ui 已是业界最佳实践，自建维护成本高、可访问性差 |
| BillingService 用 class | 纯函数式 service 更简洁，class DI 在这个规模下过度设计 |
| 43 个环境变量 | 过度配置化，Bun/Elysia 项目用合理默认值 + 必要覆盖即可 |
| monorepo 用 pnpm workspace | Bun workspace 原生支持，更简单更快 |

---

## 八、angry-mushroom 的糟粕（我们不照搬的）

| 做法 | 原因 |
|------|------|
| 视频轮询放在 server 进程内 | 我们已有独立 Worker 进程，不应回退到 in-process polling |
| 前端 setInterval 轮询视频状态 | 我们已有 PostgreSQL NOTIFY → SSE 推送链路，无需轮询 |
| SQLite 数据库 | 我们用 PostgreSQL，支持并发写入和 NOTIFY/LISTEN |
| 无认证系统 | 我们已有 JWT + bcrypt 认证，不做降级 |
| console.log 日志 | 我们用 Pino 结构化日志 + redact，不做降级 |
| 手写 API client | 我们用 Eden Treaty 端到端类型安全，不做降级 |
| 无测试 | 我们已有 20+ 测试文件，不做降级 |

---

## 九、执行路线图

### Phase 1 — 安全底线（1-2 周）
1. 速率限制 middleware
2. ESLint 严格规则（no-console, no-any in billing）
3. tsconfig 严格选项（noUncheckedIndexedAccess, exactOptionalPropertyTypes）

### Phase 2 — 计费核心（2-3 周）
1. credit_accounts + credit_transactions + usage_events 三表
2. Reserve/Debit/Refund 闭环实现
3. 前端 Billing 页面升级（余额+冻结+流水）
4. 整数分运算统一

### Phase 3 — 多租户与合规（2-3 周）
1. API Key 创建/管理/认证
2. 审计日志
3. 软删除 + 去重保护
4. DB waitForDb + healthCheck 增强

### Phase 4 — 运维可观测（1-2 周）
1. Prometheus metrics
2. OpenAPI spec（@elysiajs/openapi）
3. 数据保留策略
4. 生产部署方案（Dockerfile + nginx + compose.prod）

### Phase 5 — 业务域增强（3-4 周）★ angry-mushroom 对照
1. 新增 5 张流水线表（story_projects/characters/locations/shots/character_references）
2. 后端 novel-video 模块：6 步 pipeline 路由
3. Prompt 构建体系（prompts/ 目录 + prompt-builder）
4. 连续性检查系统（确定性规则引擎）
5. 视频生成 fallback 机制（r2v → t2v）
6. Mapper 层（DB 行 → 干净类型接口）
7. OpenAPI 文档自动生成（@elysiajs/openapi）

### Phase 6 — 前端体验升级（2-3 周）★ angry-mushroom 对照
1. PromptEditor 组件（@mention 引用插入）
2. ReferenceUploadZone 组件（拖拽上传）
3. Explore 页面 6 步工作流 UI
4. 角色/场景锁定功能
5. 视频内联预览播放

### Phase 7 — 功能增强（渐进迭代）
1. 通知系统
2. OpenAI 兼容网关（按需）
3. 文档补全