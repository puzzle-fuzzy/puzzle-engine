# Puzzle Bobble 进阶项目参考文档

面向：Claude / Codex 在改造 `excuse` 项目时参考  
来源项目：`/Users/yxswy/Documents/puzzle-bobble`  
目标项目：`/Users/yxswy/Documents/excuse`  
撰写目的：提炼 `puzzle-bobble` 中值得迁移或借鉴的工程设计、业务抽象和稳定性策略，尤其服务于当前项目的 Canvas pipeline、SSE、Worker、计费、模型目录和测试体系。

## 总体判断

`puzzle-bobble` 是一个比当前 `excuse` 更“平台化”的 AI 创作生产系统。它不只是把功能跑通，而是围绕长任务、可审计计费、可靠 Worker、模型治理、通知/SSE、运维健康检查和测试可注入性建立了比较完整的工程骨架。

当前 `excuse` 已经有 React + Elysia + Worker + DashScope + Canvas pipeline 的核心能力，但在以下方面仍可明显借鉴 `puzzle-bobble`：

- 长任务状态机与可靠任务队列。
- workflow run / step 抽象。
- SSE 与 PostgreSQL NOTIFY 的事件模型。
- 预授权、结算、退款的计费事务边界。
- 模型目录、能力、定价、参数 schema 的治理。
- 服务层和路由层分离，便于测试和维护。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。
- 前端任务状态展示、模型参数动态表单和 SSE 降级策略。

## 1. Monorepo 分层与依赖边界

### 做得好的地方

`puzzle-bobble` 把业务能力拆成 3 个 apps 和 5 个 packages：

- `apps/api`：HTTP 层，负责鉴权、路由、响应 envelope。
- `apps/web`：控制台前端。
- `apps/worker`：后台任务处理。
- `packages/core`：零依赖共享类型、错误码、日志、工具函数。
- `packages/config`：Zod 环境变量校验。
- `packages/db`：Drizzle schema + client，尽量不塞业务逻辑。
- `packages/billing`：计费、价格、模型 catalog。
- `packages/creative`：pipeline、任务创建、成本估算、provider 类型。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/README.md`
- `/Users/yxswy/Documents/puzzle-bobble/CLAUDE.md`
- `/Users/yxswy/Documents/puzzle-bobble/package.json`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/index.ts`

### 值得参考的细节

`packages/core` 使用 canonical arrays 作为 enum 单一来源，再被 DB schema 引用，避免类型漂移。

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/types.ts`

当前 `excuse` 里已经有 `packages/shared`，但 DB enum、shared type、前端类型之间仍容易重复定义。建议逐步把 Canvas 状态、shot 状态、pipeline phase、generation status 都收敛到一个 shared/core 层，然后 DB 和前端从同一处派生。

### 对 `excuse` 的建议

优先参考：

1. 建立更明确的 `packages/core` 或强化 `packages/shared`，集中维护错误码、状态枚举、日志、基础工具。
2. 把 Canvas pipeline 的 phase 定义从前端组件里抽到 shared 包，后端、worker、前端共用。
3. DB schema 不应成为所有业务类型的唯一来源；对跨 app 的业务协议，建议放在 shared/core，再由 DB schema 引用。

## 2. 环境配置治理

### 做得好的地方

`puzzle-bobble` 用 Zod 做环境变量解析、默认值、生产环境保护和跨字段校验。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.test.ts`

值得参考的细节：

- 自动向上查找 `.env`，方便 monorepo 子目录命令运行。
- `NODE_ENV=production` 时禁止默认 `JWT_SECRET`、默认 `DATABASE_URL`、默认 localhost CORS。
- provider 相关配置有跨字段校验：`bailian` 必须有 `BAILIAN_API_KEY`，`openai_compatible` 必须有 base URL、API key、model。
- worker、rate limit、provider 并发、OSS、retention 都有明确配置结构。

### 对 `excuse` 的建议

当前 `excuse` 的 `apps/server/src/config.ts` 可以参考这个结构升级：

- 用 Zod 统一校验所有 env。
- 将 server、worker、provider、storage、cors、rateLimit、retention 分组返回。
- 在生产环境阻止默认密钥和默认 CORS。
- 给 DashScope/OSS 配置做跨字段校验。

优先级：中高。它会减少部署时“变量缺了但服务照常启动”的隐性故障。

## 3. 错误码与统一 API 响应

### 做得好的地方

`puzzle-bobble` 定义了 typed error code registry 和统一响应 envelope。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/errors.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/common.ts`

值得参考的细节：

- `ErrorCode` 是 `as const`，可编译期防止拼错。
- `AppError(code, message, statusCode)` 作为业务错误边界。
- `jsonError()` 统一处理 AppError、ZodError、JSON SyntaxError、未知错误。
- `apiOk()`、`apiCreated()`、`apiPaginated()` 统一响应结构。
- dev/test 环境可用 Zod schema 校验响应形状，生产跳过。

### 对 `excuse` 的建议

当前 `excuse` 已有 `utils/errors.ts` 和一些 response 类型，但可以进一步统一：

- 所有 route 不手写 `{ success: false }`，改用统一 error handler。
- 引入 typed `ErrorCode`，覆盖 `AUTH_REQUIRED`、`MODEL_NOT_ALLOWED`、`NO_PRICING`、`TASK_NOT_CANCELLABLE`、`PROVIDER_ERROR` 等。
- 所有 API 统一 envelope，比如 `{ success: true, data }` 或 `{ data }`，不要混用。

优先级：中。改动面较大，但会让 Claude 后续修改更稳定。

## 4. Worker 任务队列可靠性

### 做得好的地方

`puzzle-bobble` 的 Worker 比当前 `excuse` 的“轮询 DashScope task”更完整。它把所有长任务统一放入 `tasks` 表，用 PostgreSQL 行级锁 claim。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/retry.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`

关键设计：

- `claimNextTask()` 使用 raw SQL：
  - `status in ('queued', 'retrying')`
  - `next_run_at <= now()`
  - `locked_until is null or locked_until < now()`
  - `for update skip locked`
  - claim 时设置 `status='running'`、`locked_by`、`locked_until`、`attempts + 1`
- `startLockHeartbeat()` 定期延长 `locked_until`，避免长任务被误抢。
- `sweepOrphanTasks()` 每分钟把锁过期 5 分钟以上的 running 任务恢复为 queued。
- `failTask()` 区分 retriable 和 permanent failure。
- 重试延迟按任务类型区分：视频更长，图片中等，文本固定。
- shutdown 时等待当前任务完成，并关闭 health server 和 DB pool。

### 当前 `excuse` 可借鉴点

`excuse` 的 `apps/worker` 目前主要处理 generation records 中的异步视频任务。Canvas pipeline 的分析、角色、场景、参考图、storyboard、prompt rebuild 仍由 server fire-and-forget 执行，可靠性较弱。

建议：

1. 长期将 Canvas pipeline 每个 phase 都迁到统一 `tasks` 表。
2. `canvas_pipeline_runs` 可以保留为 workflow/run 可视化层，但实际执行统一由 Worker claim。
3. 所有生成任务都应有 `attempts`、`maxAttempts`、`nextRunAt`、`lockedBy`、`lockedUntil`、`errorJson`。
4. 不再依赖 server 进程内 promise。server 只创建任务并返回 accepted。

优先级：高。尤其能解决当前 Canvas “自动执行全部”卡住、server 重启丢任务、SSE 事件时序不稳的问题。

## 5. Workflow Run / Step 抽象

### 做得好的地方

`puzzle-bobble` 明确区分：

- `workflowRuns`：一次完整 pipeline 执行。
- `workflowSteps`：pipeline 中的阶段。
- `tasks`：某个 step 下的实际任务。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/task-creation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/pipeline.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/orchestrator.ts`

值得参考的细节：

- `createWorkflowTask()` 在一个事务内完成：
  - 找到最新 workflow run。
  - 创建 workflow step。
  - 创建 task。
  - 同事务预占费用。
  - 更新 step.taskIds。
  - 更新 run.status/currentStepIndex。
- `getNextTaskType()` 是纯函数，集中定义 pipeline 流转。
- `FALLBACK_MODELS`、`STEP_LABELS`、`STEP_KEYS` 集中定义，API、Worker、前端都可共享。
- 人工审核点 `pipeline.approval` 是一等 step，可暂停 workflow，再由 worker 继续。
- `orchestrator.ts` 优先从 `workflowRuns.context` 读取实体 ID，避免“按 createdAt 最新一条”误关联。

### 对 `excuse` 的建议

当前 `excuse` 有 `canvas_pipeline_runs`，但 phase、run、shot 状态和前端自动执行状态耦合较多。建议参考以下重构：

- `canvas_pipeline_runs` 作为 workflow run。
- 新增或强化 `canvas_pipeline_steps`，记录 `phaseKey`、`status`、`taskIds`、`startedAt`、`finishedAt`、`errorJson`。
- 每个 phase 创建 task，不在 server 内 fire-and-forget。
- 前端只根据 run/step/task 状态渲染，不维护复杂局部 running 推断。
- Canvas 自动执行逻辑改成后端/worker orchestration，而不是前端按 SSE 推下一个接口。

优先级：高，但建议分阶段做。短期可先增加 `step` 状态和统一事件。

## 6. SSE 与 PostgreSQL NOTIFY 事件模型

### 做得好的地方

`puzzle-bobble` 将 SSE 拆成三个层次：

1. DB 通过 PostgreSQL NOTIFY 发布状态变化。
2. API `pg-listener` 监听 channel，转发到内存 `sseEventBus`。
3. 项目级 SSE endpoint 订阅 project-scoped event。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/pg-listener.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/sse-events.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/events.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/sse-client.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/hooks/use-sse.ts`

值得参考的细节：

- SSE event bus 支持 project scope：`task_status:${projectId}`。
- notification 支持 user scope：`notification:user:${userId}`。
- 每用户 SSE 连接数限制为 5，防止多 tab 或异常重连压垮进程。
- SSE route 设置 `Cache-Control: no-cache` 和 `X-Accel-Buffering: no`。
- 写 SSE 失败会 debug log，不静默吞掉。
- `stream.onAbort()` 中完整取消订阅并释放连接数。
- 前端 `useSSE()` 有指数退避重连，超过次数后进入 `polling` mode。
- 后端 pg LISTEN 也有指数退避重连。

### 对 `excuse` 的建议

当前 `excuse` 已经有 `sse-manager.ts` 和 PostgreSQL LISTEN，但仍混用：

- worker 事件走 NOTIFY。
- server fire-and-forget phase 事件直接 `dispatchToUser()`。

建议：

1. 统一 Canvas 事件 channel，例如 `canvas_pipeline_changed`。
2. 所有 Worker / server 产生的 Canvas 状态变化都写 DB 后通过 NOTIFY 发事件。
3. 事件 payload 应区分：
   - `task_status`
   - `pipeline_step`
   - `project_status`
   - `notification`
4. SSE endpoint 尽量 project-scoped：`/api/canvas/projects/:projectId/events`，避免全局事件全量分发。
5. 前端 SSE hook 明确有 `sse | polling | disconnected` 三态，并在 polling mode 定时刷新项目详情。
6. 加每用户连接数限制。

优先级：高。尤其对当前 Canvas 实时刷新体验很关键。

## 7. 通知系统与状态事件解耦

### 做得好的地方

`puzzle-bobble` 将“任务状态事件”和“用户通知”解耦：

- 任务终态事件进入 `sseEventBus`。
- `notification-listener` 监听终态事件，创建持久化 notification。
- `NotificationService.createAndEmit()` 写库后再发 notification SSE。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/notification-listener.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/services/notification.service.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/notification.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`

值得参考的细节：

- 只有 terminal status 才创建通知：`succeeded`、`failed`、`canceled`。
- 通知有 `type`、`level`、`title`、`body`、`metadata`。
- 项目无 owner 时 warn 并跳过，不让通知失败影响主流程。

### 对 `excuse` 的建议

当前 `excuse` 有 notification 路由和 SSE notification，但 Canvas pipeline 还可以更系统化：

- 任务/阶段完成由事件驱动创建通知。
- Canvas phase failed、partial_failed、completed 应产生持久通知。
- 通知创建失败不影响任务状态落库。

优先级：中。

## 8. 计费：预授权、扣费、退款和幂等性

### 做得好的地方

`puzzle-bobble` 的计费体系是它最值得借鉴的部分之一。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/billing.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/pricing.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/worker-billing.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`

值得参考的细节：

- `doReserve()`：创建任务时预占余额。
- `doDebitReservation()`：任务成功后实际扣费，同时释放未用额度。
- `doRefundReservation()`：任务失败/取消时退回预占。
- 对 credit account 使用 `SELECT FOR UPDATE` 防止并发余额错乱。
- 对 `taskId + transaction type` 建唯一索引，避免重复 reserve/debit/refund。
- final cost 大于预占时不直接卡死，而是按账户余额做 effective debit 并 warn。
- 所有金额使用 integer cents。
- `usageEvents` 记录 provider、model、usage、provider cost、charged cost、priceResolution。

### 对 `excuse` 的建议

`excuse` 现在已有 `packages/billing`、credit 逻辑和 generation cost，但可继续完善：

- Canvas phase task 创建时预估费用并 reserve。
- Worker 完成后结算实际费用。
- 失败/取消/超时统一 refund。
- `generation_records.cost` 可以保留展示，但真实账务以 credit transactions 为准。
- 对每个 task/generation record 加幂等约束，避免重复扣费。

优先级：高。AI 视频生成成本高，计费幂等性必须可靠。

## 9. 模型目录、能力和价格治理

### 做得好的地方

`puzzle-bobble` 将“模型能不能用”“模型有没有价格”“模型参数是什么”分开治理。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/model-catalog.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/model-catalog-data.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/pricing.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/model-validation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/provider-capabilities.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/model-parameter-fields.tsx`

关键设计：

- `models` 表存：
  - provider
  - model
  - label
  - category
  - taskTypes
  - endpoint
  - protocol
  - async
  - docsPath
  - summary
  - defaultParameters
  - parameterSchema
  - active
- `modelPrices` 表存：
  - provider
  - model
  - unit
  - resolution
  - officialPriceCents
  - markup basis points
  - active
- `requireBailianPricedCatalogModel()` 同时校验模型适配任务类型，并确认有价格数据。
- `PROVIDER_CAPABILITIES` 用正向声明替代“哪些 provider 不支持什么”的反向黑名单。
- 前端 `ModelParameterFields` 根据 `parameterSchema` 动态渲染表单。

### 对 `excuse` 的建议

当前 `excuse` 的 `packages/provider/src/model-configs.ts` 已有 declarative model config，这是优势。但可以参考 `puzzle-bobble` 进一步拆分：

- provider model config 继续负责请求协议和参数映射。
- 模型展示、任务适配、参数表单 schema、价格、active 状态建议进入 DB-backed catalog。
- 前端模型选择不要硬编码参数表单，改由 `parameterSchema` 渲染。
- 必须同时满足“模型允许用于此任务 + 有价格 + active”才可被 UI 选择。

优先级：中高。尤其对 DashScope 模型多、价格频繁变化的场景很有价值。

## 10. Provider 能力与任务处理器

### 做得好的地方

`puzzle-bobble` 的 Provider 抽象支持 local stub、OpenAI-compatible、Bailian/DashScope，并将不同任务分发到统一 handler。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/providers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/param-utils.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/provider-types.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/provider-capabilities.ts`

值得参考的细节：

- ProviderError 保留 status、requestId、responseBody，后续可审计。
- handler 层负责读 task.input、做运行时解析、调用 provider。
- provider 层只关心具体模型 API。
- `readString`、`readNumber`、`readRecord` 等 helper 让 jsonb input 边界解析更安全。
- 对视频任务，如果 provider 没返回 usage.videoSeconds，会根据 draft assets duration 补估 usage，避免计费缺失。

### 对 `excuse` 的建议

当前 `excuse` 的 DashScopeClient 已经很声明式，可继续保留；但 Canvas worker 层可以参考：

- 每类 Canvas phase 独立 handler。
- task.input 一律视为 unknown/jsonb，通过 helper 解析，不直接信任类型。
- ProviderError 结构化保存到 generation record / task error。
- 所有 provider 调用带 requestId/traceId/operation/model。

优先级：中。

## 11. 资产生成链路：草稿资产与占位 metadata

### 做得好的地方

`puzzle-bobble` 对图像/视频资产链路有清晰分层：

1. `shotAssetPrepare` 生成资产草稿。
2. `assetImageGenerate` 读取 image draft assets 生成关键帧。
3. `assetVideoGenerate` 读取 video draft assets，并自动匹配对应 shot 的已完成图片作为首帧。
4. `videoCompose` 合成最终视频。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/services/project.service.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/asset-persist.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/utils.ts`

值得参考的细节：

- 草稿资产用 placeholder metadata 标识。
- 生成视频前强制检查对应图片首帧是否存在，否则抛 `IMAGE_PREREQUISITE_MISSING`。
- 生成结果统一进入 `assets` 表，带 role、metadata、publicUrl、localPath、taskId。
- assets 与 shots 之间通过 metadata 中的 `shotId`、`shotIndex` 关联。

### 对 `excuse` 的建议

当前 Canvas 直接把 `referenceImageUrl` 放在角色/场景，把 `videoUrl` 放在 shot。短期足够，但如果要做更强的创作资产管理，可以参考：

- 新增或强化统一 assets 表，记录角色图、场景图、镜头图、镜头视频、音频、字幕。
- Canvas shot 只引用 assetId 或 latest asset，而不是只存 URL。
- URL 是资产输出属性，不是业务状态的唯一来源。

优先级：中。适合后续资产库、重试、版本管理。

## 12. 前端控制台可借鉴点

### 做得好的地方

虽然 `puzzle-bobble` 的 web 是控制台风格，不是精美产品 UI，但工程上有几个实用点。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/hooks/use-sse.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/sse-client.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/task-record-panel.tsx`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/model-parameter-fields.tsx`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/status.tsx`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/hooks/use-app-state.ts`

值得参考的细节：

- `useSSE()` 返回 `{ connected, mode, lastEventAt }`，UI 可明确展示实时连接状态。
- SSE 失败后指数退避，超过次数进入 polling mode。
- 任务记录表明确展示：任务 ID、状态、模型、预估、扣费。
- 动态模型参数表单直接来自 model option 的 `parameterSchema`。
- 状态组件集中管理不同 status 的显示。

### 对 `excuse` 的建议

当前 Canvas 页面可以参考：

- 顶部展示 SSE 状态：已连接 / 重连中 / polling fallback。
- Pipeline 控制器展示当前 runId、phase、elapsed、lastEventAt。
- 任务/shot 列表显示预估成本和最终成本。
- 模型参数表单从模型 schema 动态生成。

优先级：中。

## 13. 测试体系与可注入设计

### 做得好的地方

`puzzle-bobble` 的测试不依赖真实数据库，API route 使用 Hono test app + mock Drizzle，Worker 通过 `_internal` 暴露内部函数测试。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/test-helpers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/*.test.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/*.test.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/*.test.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/*.test.ts`

值得参考的细节：

- `mockDb()` 的 select/insert/update 队列可同步捕获调用顺序，支持 `Promise.all`。
- `createTestApp(routeFactory, db)` 注入 mock DB/config，不启动 HTTP server。
- `parseBody<T>()` 统一类型化解析 response JSON。
- Worker 的 `retry.ts`、`param-utils.ts`、`asset-persist.ts`、`providers.ts` 都有独立测试。

### 对 `excuse` 的建议

当前 `excuse` 已有不少测试，但可以增加：

- Canvas SSE 事件时序测试：DB 更新必须先于 notify。
- Pipeline auto-run 测试：SSE 丢失时 polling 能推进。
- Worker timeout/cancel/refund 测试。
- Model config validation 测试覆盖每个 DashScope 模型映射。

优先级：高。尤其 SSE/Worker 需要回归测试保护。

## 14. 运维与健康检查

### 做得好的地方

`puzzle-bobble` 的 Worker 有独立 health server 和 Prometheus metrics endpoint。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/metrics.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/pool-stats.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/api-metrics.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/client.ts`

值得参考的细节：

- `/health` 返回：
  - workerId
  - running
  - lastActiveAt
  - tasksProcessed
  - ffmpegAvailable
  - database
  - version
  - uptime
  - memory
- `/metrics` 输出 Prometheus 文本。
- shutdown 时 health server 先关闭，避免 LB 继续打流量。
- API 启动后有 retention cleanup。

### 对 `excuse` 的建议

当前 `excuse` 可以参考：

- Worker 增加 health port。
- 增加 metrics：SSE 连接数、任务处理数、失败数、平均耗时、provider error count。
- Server/worker 都输出 version、db 状态、storage 状态。
- Worker shutdown 等待当前任务结束并关闭 DB pool。

优先级：中高。

## 15. 文档与开发流程

### 做得好的地方

`puzzle-bobble` 的文档覆盖了架构、API、DB、Web 控制台、Worker、本地端到端联调、百炼资料、实现计划和 dev log。

关键文件：

- `/Users/yxswy/Documents/puzzle-bobble/docs/00-项目简报.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/01-架构说明.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/03-最小API说明.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/04-Web控制台说明.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/05-本地端到端联调.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/06-Worker任务系统说明.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/07-百炼资料与价格种子说明.md`
- `/Users/yxswy/Documents/puzzle-bobble/TODO.md`
- `/Users/yxswy/Documents/puzzle-bobble/docs/dev-log/`

### 对 `excuse` 的建议

建议补齐：

- `docs/canvas-pipeline.md`：Canvas 状态机、phase、事件、任务表。
- `docs/sse-events.md`：所有 SSE event payload、来源、消费方、重连策略。
- `docs/worker-task-system.md`：claim、retry、timeout、billing。
- `docs/model-catalog.md`：模型配置、参数 schema、定价来源。

优先级：中。对 Claude 持续协作非常有帮助。

## 迁移优先级建议

### P0：立刻影响稳定性的项

1. 统一 Canvas 事件：所有 phase/shot/project 状态变化先写库，再 NOTIFY，再 SSE。
2. 前端 SSE 失败后进入 polling fallback。
3. Canvas Worker 超时、失败、取消都必须更新 shot/project 并退款。
4. 为 Canvas SSE/Worker 时序补测试。

### P1：平台化任务系统

1. 新增统一 `tasks` 表或将现有 generation records/task polling 泛化。
2. 引入 `lockedBy`、`lockedUntil`、`attempts`、`nextRunAt`。
3. Worker 使用 `FOR UPDATE SKIP LOCKED` claim。
4. 增加 lock heartbeat 和 orphan sweep。
5. 每个 Canvas phase 都由 Worker 执行，不由 server fire-and-forget。

### P2：Workflow 和计费

1. 将 Canvas pipeline 抽象成 workflow run / step / task。
2. task 创建时预估费用并 reserve。
3. task 成功 debit，失败/取消/超时 refund。
4. 增加 credit transaction 幂等约束。

### P3：模型治理和前端体验

1. 将模型 catalog + price + parameterSchema DB 化。
2. 前端模型参数表单动态渲染。
3. Canvas 顶部显示 SSE/polling 状态和 lastEventAt。
4. 任务面板显示预估费用、最终扣费、重试次数、错误详情。

## 给 Claude 的执行提示

如果让 Claude 基于本参考文档改造 `excuse`，建议按这个顺序下任务：

1. “请参考 `puzzle-bobble` 的 SSE 事件模型，先为 `excuse` 写一份 `docs/sse-events.md`，列出现有事件和缺口，不改代码。”
2. “请把 Canvas worker 的视频完成时序改为先写库后发事件，并补测试。”
3. “请为 Canvas 前端 SSE hook 增加 `sse | polling | disconnected` 模式，并在 polling 下定时刷新项目。”
4. “请设计 `tasks` 表和 Worker claim 机制，参考 `puzzle-bobble/apps/worker/src/index.ts`，先只支持 Canvas phase task。”
5. “请把 Canvas analyze/characters/locations/storyboard/rebuild 从 server fire-and-forget 迁到 Worker task。”
6. “请引入 workflow step 抽象，让自动执行全部由后端 orchestrator 推进，而不是前端逐步调用接口。”

## 注意事项

- 不建议直接照搬 `puzzle-bobble` 的 Hono 架构到 `excuse`；`excuse` 当前使用 Elysia + Eden treaty，保留即可。
- 不建议一次性迁移所有 Worker/task/workflow/billing。优先解决 Canvas 可靠性，再做平台化。
- `puzzle-bobble` 的前端是控制台风格，不适合作为视觉设计参考；它更适合作为状态展示、模型参数表单和 SSE fallback 的工程参考。
- `puzzle-bobble` 的 DB task queue 适合当前规模；如果未来任务量更大，再考虑 Redis/BullMQ/Temporal，不要过早引入重型系统。
