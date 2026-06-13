# Puzzle Bobble + Lumora 进阶项目参考文档

面向：Claude / Codex 在改造 `excuse` 项目时参考  
来源项目 A：`/Users/yxswy/Documents/puzzle-bobble`  
来源项目 B：`/Users/yxswy/Documents/unknown/lumora`  
目标项目：`/Users/yxswy/Documents/excuse`  
撰写目的：提炼 `puzzle-bobble` 与 `lumora` 中值得迁移或借鉴的工程设计、业务抽象和稳定性策略，尤其服务于当前项目的 Canvas pipeline、SSE、Worker、计费、模型目录、资产回显、API Gateway 产品化和测试体系。

## 总体判断

`puzzle-bobble` 是一个比当前 `excuse` 更“平台化”的 AI 创作生产系统。它不只是把功能跑通，而是围绕长任务、可审计计费、可靠 Worker、模型治理、通知/SSE、运维健康检查和测试可注入性建立了比较完整的工程骨架。

`lumora` 则更像一个“多产品线 AI 平台”：它把创作端、模型实验台、管理后台、客户自助端和 API Gateway 分成独立前端，同时共享 task、asset、pricing、credit、model-registry、provider、workflow 等底层能力。它对当前 `excuse` 的参考价值主要在产品边界、资产轮询契约、API Key/credit 商业化、Workflow stepper、任务元数据治理和多端隔离。

当前 `excuse` 已经有 React + Elysia + Worker + DashScope + Canvas pipeline 的核心能力，但在以下方面仍可明显借鉴 `puzzle-bobble`：

- 长任务状态机与可靠任务队列。
- workflow run / step 抽象。
- SSE 与 PostgreSQL NOTIFY 的事件模型。
- 预授权、结算、退款的计费事务边界。
- 模型目录、能力、定价、参数 schema 的治理。
- 服务层和路由层分离，便于测试和维护。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。
- 前端任务状态展示、模型参数动态表单和 SSE 降级策略。

同时，`lumora` 还补充了以下值得参考的方向：

- 四个前端产品线物理隔离：creative、model-lab、admin、customer。
- 创作端统一资产轮询契约：assets、bindings、activeTasks、costs。
- API Gateway 的客户、key、scope、quota、rate limit、usage、credit ledger 闭环。
- `TaskTypeRegistry` 为每类任务声明 billing、asset、recovery 策略。
- Workflow stepper 将自动执行从前端按钮链路转移到 worker orchestration。
- API 前缀按产品归属分区，避免无边界 route 膨胀。

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

优先级：P3-6。改动面较大，建议在 P0/P1 落地后再启动。

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

优先级：P3（中）。改动面较大，可随 P2/P3 推进时逐步统一。

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

优先级：P0-1 + P0-2。根因修复，详见优先级章节。

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

优先级：P0-3 + P0-4。根因修复，详见优先级章节。短期先增加 step 状态和统一事件，中期引入 WorkflowStepper。

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

优先级：P0-4（根因修复）+ P1-2（降级通用化）。详见优先级章节。

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

优先级：P2-2（通知系统解耦）。详见优先级章节。

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

优先级：P2-3（幂等约束）+ P1-3（Canvas 接入）。reserve/debit/refund 已实现，详见优先级章节。

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

优先级：P3-1（模型目录 DB 化）。详见优先级章节。

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

优先级：P0-3（Canvas phases 由 Worker 执行）。详见优先级章节。

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

优先级：P3（中长期）。适合后续资产库、重试、版本管理。

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

优先级：P1-2（SSE 降级通用化）+ P3-1（模型参数表单）。详见优先级章节。

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

优先级：P0-5（时序补测试）。详见优先级章节。

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

优先级：P3-3（Worker 健康检查 + Metrics）。详见优先级章节。

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

优先级：P3-5（文档补齐）。详见优先级章节。

## 16. Lumora 的多产品线平台边界

### 做得好的地方

`lumora` 最大的优势不是某个单点功能，而是把同一套 AI 生产能力拆成多个清晰产品线：

- `creative-web`：创作端，负责小说、剧本、镜头、资产、最终视频。
- `model-lab-web`：模型实验台，负责内部模型测试、参数验证、成本验证。
- `admin-web`：管理后台，负责客户、价格、用量、账务、成本、运营。
- `customer-web`：客户自助端，负责 API Key、余额、用量、流水、任务。
- `apps/api` 和 `apps/worker`：统一后端和统一长任务执行器。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/README.md`
- `/Users/yxswy/Documents/unknown/lumora/docs/architecture/架构说明.md`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/项目总览与路线图.md`
- `/Users/yxswy/Documents/unknown/lumora/package.json`

### 值得参考的细节

`lumora` 明确规定正式 API 前缀：

- `/api/creative/*`
- `/api/model-lab/*`
- `/api/admin/*`
- `/api/customer/*`
- `/api/gateway/v1/*`

这种分区能让权限、产品入口、文档和测试边界都更清楚。当前 `excuse` 已经有 `/api/canvas`、`/api/generate`、`/api/billing`、`/v1` 等能力，但产品归属还不够清晰，容易出现“后端能力已经暴露，但前端和产品决策还没准备好”的状态。

### 对 `excuse` 的建议

短期不建议把前端拆成四个应用，但建议先学习它的 API 边界：

1. 将 Canvas/创作链路统一归入创作域，例如继续使用 `/api/canvas/*`，但文档里明确它等价于 `creative` 产品线。
2. 将 OpenAI-compatible Gateway 和 API Key 明确归入 gateway 产品线，避免混在普通用户生成接口里。
3. 如果 API Key 暂不开放，就不要在用户端出现入口；如果开放，就必须补客户自助页和调用文档。
4. 后续如果做管理后台，不要把 admin 页面混进普通 workspace，应单独路由、单独鉴权、单独 API 前缀。

优先级：P3-4（API Key / Gateway 商业化决策）。详见优先级章节。

## 17. Lumora 的统一资产轮询契约

### 做得好的地方

`lumora` 没有让前端直接依赖 task output 展示生成结果，而是抽象出统一 `/assets/poll` 契约。这个契约一次返回：

- `assets`：项目下所有可展示资产。
- `bindings`：资产和业务对象之间的绑定关系。
- `activeTasks`：正在执行的任务。
- `costs`：任务对应的预估/最终成本。
- `generatedAt`：响应生成时间，便于前端判断数据新鲜度。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/docs/operations/资产轮询与成本回显契约.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/generate/service.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/web-api-client/src/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/hooks.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/components/ShotCard.tsx`

### 值得参考的细节

`AssetQueryService.getProjectAssetsPoll()` 不是简单返回任务列表，而是主动构建业务友好的 binding：

- shot binding：`latestImageAssetId`、`latestVideoAssetId`、`imageAssetIds`、`videoAssetIds`、`activeImageTaskIds`、`activeVideoTaskIds`。
- character binding：`referenceAssetId`、`activeImageTaskIds`。
- scene binding：`conceptAssetId`、`activeImageTaskIds`。
- project binding：`finalVideoAssetId`、`finalVideoTaskIds`。
- cost entry：`estimated`、`debited`、`refunded`、`failed_without_charge` 等状态。

前端 `useProjectAssetsPolling()` 也值得参考：活跃任务存在时 2 秒轮询，空闲时 10 秒轮询。它把 polling 作为生成反馈的单一事实来源，而不是只依赖 SSE。

### 对 `excuse` 的建议

这对当前 Canvas “必须刷新才能看到视频/图片结果”的问题非常关键。建议 `excuse` 不要把 SSE 当成唯一数据通道，而是采用：

1. SSE 只负责告诉前端“有变化了”。
2. 前端收到 SSE 后调用统一 poll/detail 接口刷新真实数据。
3. SSE 断开或漏事件时，前端继续低频 polling。
4. Canvas 详情页增加类似 `/api/canvas/projects/:projectId/assets/poll` 的契约，返回 shots、characters、locations、assets、activeTasks、costs、projectStatus。

建议字段：

```ts
interface CanvasAssetsPoll {
  scope: 'canvas'
  projectId: string
  projectStatus: string
  assets: Array<CanvasAsset>
  bindings: {
    shots: Array<{
      shotId: string
      imageUrl: string | null
      videoUrl: string | null
      activeImageTaskIds: string[]
      activeVideoTaskIds: string[]
      status: string
    }>
    characters: Array<{
      characterId: string
      referenceImageUrl: string | null
      activeTaskIds: string[]
    }>
    locations: Array<{
      locationId: string
      referenceImageUrl: string | null
      activeTaskIds: string[]
    }>
  }
  activeTasks: Array<{ id: string; type: string; status: string; targetId: string }>
  costs: Array<{ taskId: string; state: string; estimatedCostCents: number; finalCostCents: number }>
  generatedAt: number
}
```

优先级：P1-1（Asset-centric polling 端点）。详见优先级章节。

## 18. Lumora 的 TaskTypeRegistry 任务元数据治理

### 做得好的地方

`lumora` 为任务类型建立了元数据注册表，每种任务声明：

- domain：任务属于 creative、model_lab、gateway、novel、compose 等哪个业务域。
- category：llm、image、video、audio、compose 等成本分类。
- billingMode：是否需要 reserve/debit/refund。
- assetMode：是否需要持久化输出资产。
- recoveryMode：provider polling、retry 或 none。
- allowConcurrentPerTarget：是否允许同一目标并发生成。
- costCategory 和 assetScope：用于成本中心和资产隔离。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/packages/task-engine/src/task-metadata.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/task-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/registry.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.ts`

### 值得参考的细节

这比在每个 worker handler 里写 if/else 更稳。比如：

- `shot.generateImage`：需要计费、需要资产持久化、需要 provider_poll recovery。
- `novel.writeOutline`：不计费、不产出媒体资产、失败后 retry。
- `gateway.generateVideo`：需要计费、需要资产/任务追踪、属于 gateway_customer 成本分类。

恢复逻辑 `recoverStaleRunningTasks()` 也利用 task metadata 判断 stale task 应该 poll provider、持久化资产、结算计费还是退款。

### 对 `excuse` 的建议

当前 `excuse` 的 Canvas phase、普通 generate、OpenAI Gateway、worker video polling 已经有多种任务形态，但缺少统一任务元数据。建议建立 `packages/shared` 或 `packages/provider` 级别的 task definition：

```ts
type TaskBillingMode = 'none' | 'reserve_debit_refund'
type TaskAssetMode = 'none' | 'persist_output'
type TaskRecoveryMode = 'none' | 'provider_poll' | 'retry'

interface TaskDefinition {
  type: string
  domain: 'canvas' | 'generate' | 'gateway' | 'system'
  category: 'text' | 'image' | 'video' | 'compose'
  billingMode: TaskBillingMode
  assetMode: TaskAssetMode
  recoveryMode: TaskRecoveryMode
  allowConcurrentPerTarget: boolean
}
```

优先先覆盖：

- `canvas.analyze`
- `canvas.extractCharacters`
- `canvas.extractLocations`
- `canvas.generateReferences`
- `canvas.createStoryboard`
- `canvas.generateShotVideo`
- `generate.image`
- `generate.video`
- `gateway.chatCompletion`

优先级：P2-1（TaskTypeRegistry）。详见优先级章节。

## 19. Lumora 的 Workflow Stepper 自动推进

### 做得好的地方

`lumora` 将“自动执行全部”放在 worker 侧推进，而不是让前端连续调用多个接口。`WorkflowStepper` 读取 workflow run、step、task 状态，然后决定：

- pending step：创建一个或多个 task，并标记 step running。
- running step：检查 task 是否全部成功、部分失败、全部失败或仍在执行。
- batch step：允许部分成功后继续下一步。
- parse step 完成后：把新生成的 scriptId 写回 workflow context。
- run 完成：自动标记 completed。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/stepper.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/workflow/routes.ts`

### 值得参考的细节

`chapterToVideoSteps` 把流程定义集中在一个数组里：

- summarize
- review
- parse
- character_images
- scene_concepts
- shot_images
- shot_videos
- compose

每个 step 都有 `buildInputs()`，可根据当前上下文和数据库实体 fan-out 出多个任务。比如 shot image/video 会自动收集角色资产和场景资产作为参考图。

### 对 `excuse` 的建议

当前 Canvas 的“自动执行全部”如果依赖前端点击、SSE 回调再触发下一步，很容易出现卡顿、漏事件、刷新后状态不一致。建议改成：

1. 前端点击“自动执行全部”只创建一个 `canvas_pipeline_run`，不负责逐步调用每个 phase。
2. Worker/stepper 根据 run 的 currentStep 推进 analyze、characters、locations、refs、storyboard、prompts、videos。
3. 每个 step 都落库，前端只渲染 run/step/task 状态。
4. SSE 只广播 step/task/project changed，前端收到后刷新 poll/detail。
5. 自动执行可以暂停、取消、恢复，而不是绑定在浏览器页面生命周期上。

优先级：P0-3（Canvas phases 由 Worker 执行）+ 中期 WorkflowStepper。详见优先级章节。

## 20. Lumora 的 API Gateway 商业化闭环

### 做得好的地方

`lumora` 的 Gateway 不是简单代理接口，而是完整商业化链路：

- customer
- API key
- scope
- rate limit
- daily/monthly quota
- credit account
- reserve/debit/refund ledger
- usage event
- customer web 自助查询
- admin web 成本中心

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/docs/product/API网关产品设计.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/proxy-routes.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/billing.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/quota.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/rate-limit.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/customer-web/src/features/customer/pages/CustomerKeysPage.tsx`
- `/Users/yxswy/Documents/unknown/lumora/packages/credit-ledger/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/pricing-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/api-gateway/src/index.ts`

### 值得参考的细节

`GatewayProxyService` 的顺序很清楚：

1. validate model。
2. resolve price。
3. create task。
4. reserve credits。
5. 同步任务直接调用 provider，异步任务交给 worker。
6. 成功后 settleSuccess，失败后 settleFailure。
7. 记录 usage/cost。
8. reservation 失败时立即 mark task failed，避免 worker 后续捡到无法结算的任务。

`CustomerKeysPage` 也提供了 API Key 产品化细节：

- 创建密钥表单。
- secret 只显示一次。
- 复制按钮。
- key prefix 展示。
- status badge。
- rate limit、daily quota、monthly quota、last used、expires at。

### 对 `excuse` 的建议

当前 `excuse` 已经有 API Key、credit repository、OpenAI Gateway route，但产品化还没收口。建议参考 `lumora` 做三层决策：

1. 如果 Gateway 暂不正式开放：
   - 不提供前端入口。
   - 文档标注 internal/beta。
   - 部署层确认 `/v1` 是否外部可访问。
2. 如果 Gateway 开放给用户：
   - 增加 API Key 管理页。
   - secret 只显示一次。
   - 支持 key 命名、撤销、scope、rate limit、quota。
   - 增加 usage、transactions、balance 页面。
3. 如果 Gateway 只是内部兼容 OpenAI：
   - 不做 customer 多租户，但也要保留 reserve/debit/refund、限流、错误码和审计。

优先级：P3-4（Gateway 商业化决策）。详见优先级章节。

## 21. Lumora 的资产持久化与 Provider URL 策略

### 做得好的地方

`lumora` 把 provider 临时 URL、本地文件、OSS URL 和前端可访问 URL 区分得比较清楚。资产持久化服务负责：

- 下载 provider 结果。
- 写入本地 storage。
- 尝试上传 OSS。
- 创建 asset 记录。
- 保存 `sourceUrl`、`localPath`、`publicUrl`、`providerUrl`。
- OSS 上传失败不阻塞资产创建，但写入 metadata 记录失败原因。
- 给后续 provider 调用解析可用参考图 URL，优先 `providerUrl`，再 fallback。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/asset-persistence.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/asset-service/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/asset-service/src/oss.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-image.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-video.ts`

### 对 `excuse` 的建议

当前 Canvas 对视频/图片回显高度依赖 provider 输出和 generation record。建议逐步改成资产表为中心：

- 每个生成结果都创建 asset 记录。
- shot/character/location 只保存当前选中 assetId 或 URL 快照。
- 前端展示永远优先读 asset/publicUrl。
- provider 参考图优先读 provider-accessible URL，避免本地 URL 被 DashScope 访问不到。
- OSS 上传失败要能在 metadata 中追踪，而不是静默导致后续 R2V/I2V 失败。

优先级：P3（中长期）。依赖 P1-1 asset-centric polling 先落地，再逐步改成资产表为中心。

## 22. Lumora 的模型注册与参数能力校验

### 做得好的地方

`lumora` 的 `model-registry` 不只列模型名，还记录模型能力：

- category：image/video。
- inputModes：text/image/video 等输入模式。
- supported sizes、ratio、duration。
- 是否支持 negativePrompt、promptExtend、audioSetting。
- video media requirement：t2v、i2v、r2v、edit。
- 默认模型。
- studio catalog 分组。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/bailian.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/model-lab-web/src/features/studio/components/ModelSelector.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/model-lab-web/src/features/studio/components/GenerateForm.tsx`

### 值得参考的细节

`getVideoMediaRequirement()` 根据模型能力判断：

- 无图片输入：T2V。
- 单图片输入：I2V。
- 多图片输入：R2V。

这和 `excuse` Canvas 的 shot video 非常相关。一个镜头到底该用 T2V、I2V、还是 R2V，不应该只靠用户猜，而应由参考资产数量和模型能力共同决定。

### 对 `excuse` 的建议

`excuse` 已经有 `packages/provider/src/model-configs.ts`，建议继续保留声明式 provider config，但补充能力层：

- 每个模型声明 `inputModes`、`maxInputImages`、`supportedRatios`、`durationRange`。
- Canvas 生成视频时自动判断 T2V/I2V/R2V。
- 前端模型选择器只展示当前输入条件可用的模型。
- 后端二次校验，避免前端绕过导致 provider error。

优先级：P3-2（模型能力校验）。详见优先级章节。

## 23. Lumora 的测试矩阵与验收文档

### 做得好的地方

`lumora` 给不同改动类型明确了必跑测试和边界：

- TypeScript 改动跑 typecheck。
- Worker handler 要测 recovery、asset persistence。
- DB schema/migration 要测 migration 和 repository。
- 计费要测余额不足、预占、扣费、退款、恢复不重复扣费。
- 权限要测客户隔离、scope、admin/customer 互斥。
- 长任务要测 cancel、provider 空结果、OSS 失败、Worker 重启恢复。

关键文件：

- `/Users/yxswy/Documents/unknown/lumora/docs/operations/测试策略与验收矩阵.md`
- `/Users/yxswy/Documents/unknown/lumora/packages/credit-ledger/src/index.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/task-engine/src/index.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/money-flow.test.ts`

### 对 `excuse` 的建议

建议新增或扩展 `docs/测试策略与验收矩阵.md`，至少覆盖：

- Canvas SSE：事件漏发、重复事件、断线重连、polling fallback。
- Canvas 自动执行：刷新页面后继续显示真实状态。
- Canvas 资产回显：图片/视频生成后无需刷新可见。
- Worker：provider 成功但存储失败、超时、取消、重复恢复。
- Credit：每个收费任务 reserve/debit/refund 幂等。
- Gateway：API Key scope、限流、余额不足、错误码稳定。

优先级：P3-5（文档补齐）+ P0-5（时序补测试）。验收矩阵与 P0-5 同步推进。

## 已完成项（2026-06-13 更新）

以下内容已在近期开发中落地，不再列入优先级：

| 项目 | 状态 | 说明 |
|------|------|------|
| Pipeline 状态展示丰富化 | ✅ 已完成 | `RunningPhaseInfo` 接口，展示当前阶段标签、模型名、耗时 |
| 运行状态刷新保持 | ✅ 已完成 | `fetchCanvasPipelineRuns` + `getActivePipelineRun` 恢复刷新后运行态 |
| 按失败阶段重试 | ✅ 已完成 | `failedPhaseIdx` state，重试按钮只触发失败阶段而非从头开始 |
| 节点重新生成（同级节点） | ✅ 已完成 | 角色/场景/镜头 regenerate 端点，创建同级节点而非替换旧节点 |
| storyboard max_tokens bug | ✅ 已完成 | 8192 → 8000 |
| 服务端 catch 不再设 status:'failed' | ✅ 已完成 | 阶段失败保留项目进度状态，不重置为 failed |
| 计费 reserve/debit/refund 基础 | ✅ 已完成 | `credit.repo.ts` 已有 reserve/debit/refund 幂等链路，generate 和 openai-gateway 已接入 |
| 统一 response DTO 重构 | ✅ 已完成 | auth/api-key/billing/upload/canvas/generation 各域响应 DTO 已统一 |
| Subtitle 管线 | ✅ 已完成 | ASR → SRT → burn 全链路已落地 |
| SSE polling 兜底（局部） | ✅ 部分完成 | PipelineController 有 3 秒 polling pipeline runs 兜底，但非通用化 |
| P0-1：统一 tasks 表 + claim 机制 | ✅ 已完成 | `tasks` 表（schema + repo + migration），`FOR UPDATE SKIP LOCKED` claim，heartbeat extend，orphan sweep，canvas_pipeline_runs 加 taskId FK |
| P0-2：Lock heartbeat + Orphan sweep | ✅ 已完成 | Worker claim 循环 + `startTaskHeartbeat()` + `sweepOrphanTasks(5min)` + handler dispatch 骨架 + retriable/permanent 错误分类 |

## 优先级调整说明

原文档的 P0-P3 有大量重叠：P0 的”统一 Canvas 事件”和 P1 的”Canvas phase 由 Worker 执行”其实是同一个改造的两个面。调整后的优先级以 **改造层次** 为维度，而非零散条目：

- **P0**：根因修复 — Canvas 执行从 fire-and-forget 迁到 Worker task queue。一旦完成，server 重启丢任务、前端驱动执行、无 claim/lock、无孤儿恢复等问题全部根除。
- **P1**：数据层保障 — 前端必须能可靠看到结果。asset-centric polling + SSE 降级通用化 + Canvas 接入已有计费链路。
- **P2**：元数据治理 — TaskTypeRegistry + 计费闭环完善 + 通知系统。依赖 P0 基础设施。
- **P3**：平台成熟度 — 模型目录 DB 化、健康检查、Gateway 商业化、文档补齐。中长期目标。

---

### P0：根因修复 — Canvas Worker Task Queue

**目标**：将 Canvas 执行从 server fire-and-forget 迁到 Worker task queue，一次改造根除所有可靠性问题。

当前问题：server 进程内 promise 执行 phase，server 重启丢任务；无 claim/lock，多 worker 会 race；无 heartbeat/orphan sweep，任务卡住无人恢复；前端依赖 SSE 事件逐步调用接口驱动”自动执行全部”，漏事件则卡顿。

#### P0-1：统一 tasks 表 + claim 机制

参考 `puzzle-bobble/apps/worker/src/index.ts` 和 `lumora/packages/task-engine`。

- 新增 `tasks` 表或泛化现有 `generation_records`，增加 `lockedBy`、`lockedUntil`、`attempts`、`maxAttempts`、`nextRunAt`、`errorJson` 字段。
- Worker 使用 `FOR UPDATE SKIP LOCKED` claim task，支持多实例并行无 race。
- 现有 `canvasPipelineRuns` 保留为 workflow run 可视化层，新增 `canvasPipelineSteps` 记录每 phase 的 taskId、status、errorJson。

关键参考文件：
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`

#### P0-2：Lock heartbeat + Orphan sweep

参考 `puzzle-bobble/apps/worker/src/index.ts` 的 `startLockHeartbeat()` 和 `sweepOrphanTasks()`。

- claim 后定期延长 `lockedUntil`，避免长任务被误抢。
- 后台每分钟扫描 `lockedUntil < now() - 5min` 的 running task，恢复为 queued。
- 失败区分 retriable vs permanent，按任务类型调整重试延迟。

#### P0-3：Canvas phases 由 Worker 执行

将 analyze、characters、locations、refs、storyboard、rebuild、videos 每个 phase 都作为 task 插入 tasks 表，由 Worker claim 并执行。Server 只创建 task 并返回 `{ accepted: true, taskId }`。

参考 `puzzle-bobble/packages/creative/src/pipeline.ts` 和 `lumora/packages/workflow-engine/src/index.ts` 的 orchestrator/stepper 模式。

短期方案：每个 phase 仍独立 task，Worker handler 直接调用现有 service 函数（`analyzeProject`、`generateCharacters` 等）。
中期方案：引入 WorkflowStepper，Worker 根据 run 的 currentStep 自动推进下一步，前端不再驱动执行。

#### P0-4：所有状态变化先写库再发事件

参考 `puzzle-bobble/apps/api/src/modules/pg-listener.ts` 的三层模型。

- Worker 完成 phase → 更新 step/task/project status → NOTIFY → SSE。
- 不再有 server 进程内 `dispatchToUser()` 绕过 DB。
- 前端收到 SSE 事件后，以 poll/detail 数据为准渲染。

#### P0-5：为 Canvas SSE/Worker 时序补测试

- DB 更新必须先于 notify。
- Worker crash 后 orphan 能被恢复。
- 多 Worker 并发 claim 无重复执行。
- Pipeline auto-run 不依赖前端按钮链路。

---

### P1：数据层保障 — 前端可靠看到结果

**目标**：无论 SSE 连接状态如何，前端都能正确展示项目状态、资产和进度。

#### P1-1：Canvas asset-centric polling 端点

参考 `lumora/docs/operations/资产轮询与成本回显契约.md` 和 `AssetQueryService.getProjectAssetsPoll()`。

新增 `/api/canvas/projects/:projectId/assets/poll`，一次返回：

```ts
interface CanvasAssetsPoll {
  scope: 'canvas'
  projectId: string
  projectStatus: string
  shots: Array<{
    shotId: string; imageUrl: string | null; videoUrl: string | null
    status: string; activeImageTaskIds: string[]; activeVideoTaskIds: string[]
  }>
  characters: Array<{
    characterId: string; referenceImageUrl: string | null; activeTaskIds: string[]
  }>
  locations: Array<{
    locationId: string; referenceImageUrl: string | null; activeTaskIds: string[]
  }>
  activeTasks: Array<{ id: string; type: string; status: string; targetId: string }>
  costs: Array<{ taskId: string; state: string; estimatedCostCents: number; finalCostCents: number }>
  generatedAt: number
}
```

SSE 只负责通知”有变化”，前端收到后调用此接口刷新真实数据。SSE 断线时前端低频 polling。

#### P1-2：SSE 降级通用化

参考 `puzzle-bobble/apps/web/src/hooks/use-sse.ts` 的 `{ connected, mode, lastEventAt }` 三态。

- 通用 SSE hook 明确 `sse | polling | disconnected` 三态。
- SSE 失败后指数退避重连，超限进入 polling mode。
- Polling mode 定时调用 asset-centric poll 接口。
- 顶部展示 SSE 连接状态和 lastEventAt。
- 现有 PipelineController 的局部 polling 可迁移到此通用 hook。

#### P1-3：Canvas 接入已有计费链路

当前 `credit.repo.ts` 已有 reserve/debit/refund 幂等链路，但 Canvas phase 的 fire-and-forget 未接入。

- Worker 执行 Canvas phase 前先 reserve 预估费用。
- Phase 成功 → debit 实际费用。
- Phase 失败/取消/超时 → refund。
- 依赖 P0-3（Worker 执行 Canvas phase）完成后才能接入。

---

### P2：元数据治理

**目标**：为每种任务类型声明 billing/asset/recovery 策略，建立通知闭环，完善计费幂等约束。依赖 P0 基础设施。

#### P2-1：TaskTypeRegistry

参考 `lumora/packages/task-engine/src/task-metadata.ts`。

为每类任务声明元数据：

```ts
interface TaskDefinition {
  type: string
  domain: 'canvas' | 'generate' | 'gateway' | 'system'
  category: 'text' | 'image' | 'video' | 'audio' | 'compose'
  billingMode: 'none' | 'reserve_debit_refund'
  assetMode: 'none' | 'persist_output'
  recoveryMode: 'none' | 'provider_poll' | 'retry'
  allowConcurrentPerTarget: boolean
}
```

优先覆盖：canvas.analyze、canvas.extractCharacters/Locations、canvas.generateReferences、canvas.createStoryboard、canvas.generateShotVideo、generate.image/video、gateway.chatCompletion。

#### P2-2：通知系统解耦

参考 `puzzle-bobble/apps/api/src/modules/notification-listener.ts`。

- 任务/阶段终态（succeeded/failed/cancelled）由事件驱动创建持久通知。
- Canvas phase partial_failed / completed 产生通知。
- 通知创建失败不影响任务状态落库。

#### P2-3：Credit transaction 幂等约束

当前 reserve/debit/refund 已有幂等逻辑，但缺少 DB 级唯一索引防护。

- 对 `taskId + transaction type` 建唯一索引。
- final cost > 预占时不卡死，按账户余额 effective debit 并 warn。

---

### P3：平台成熟度

**目标**：中长期产品化和运维能力提升。可在 P0/P1 推进期间并行启动，不阻塞主线。

#### P3-1：模型目录 DB 化

参考 `puzzle-bobble/packages/billing/src/model-catalog.ts` 和 `lumora/packages/model-registry/src/index.ts`。

- 模型展示、任务适配、参数表单 schema、价格、active 状态建议进入 DB-backed catalog。
- `model-configs.ts` 继续负责请求协议和参数映射。
- 前端模型选择器由 `parameterSchema` 动态渲染，不硬编码表单。
- 必须同时满足”模型允许用于此任务 + 有价格 + active”才可被 UI 选择。

#### P3-2：模型能力校验

参考 `lumora/packages/model-registry/src/models/types.ts` 的 `getVideoMediaRequirement()`。

- 每个模型声明 `inputModes`、`maxInputImages`、`supportedRatios`、`durationRange`。
- Canvas 生成视频时自动判断 T2V/I2V/R2V。
- 后端二次校验，避免前端绕过导致 provider error。

#### P3-3：Worker 健康检查 + Metrics

参考 `puzzle-bobble/apps/worker/src/index.ts` 的 health server 和 Prometheus metrics。

- Worker 增加 health port：返回 workerId、running、lastActiveAt、tasksProcessed、db status、version、uptime。
- 增加 metrics：SSE 连接数、任务处理数、失败数、平均耗时、provider error count。
- Server/worker 都输出 version、db 状态、storage 状态。

#### P3-4：API Key / Gateway 商业化决策

参考 `lumora/docs/product/API网关产品设计.md` 和 `CustomerKeysPage`。

三层决策：
1. **暂不开放**：不提供前端入口，文档标注 internal/beta，确认 `/v1` 是否外部可访问。
2. **开放给用户**：增加 API Key 管理页（secret 只显示一次、key 前缀展示、scope/quota/rate limit）+ usage/transactions/balance 页面。
3. **内部兼容**：不做多租户，但保留 reserve/debit/refund、限流、错误码和审计。

当前建议先选方案 1（暂不开放），等 P0/P1 落地后再评估方案 2。

#### P3-5：文档补齐

- `docs/canvas-pipeline.md`：状态机、phase、事件、任务表。
- `docs/sse-events.md`：所有 SSE event payload、来源、消费方、重连策略。
- `docs/worker-task-system.md`：claim、retry、timeout、billing。
- `docs/测试策略与验收矩阵.md`：覆盖 Canvas SSE、自动执行、资产回显、Worker timeout/cancel/refund、Credit 幂等、Gateway scope/限流。

#### P3-6：环境配置治理

参考 `puzzle-bobble/packages/config/src/index.ts`。

- 用 Zod 统一校验所有 env，将 server/worker/provider/storage/cors/rateLimit/retention 分组。
- 生产环境阻止默认密钥和默认 CORS。
- DashScope/OSS 跨字段校验。

## 给 Claude 的执行提示

按以下顺序下任务，每完成一项 commit 并标记已完成：

1. **P0-1**：”请为 `excuse` 设计统一 `tasks` 表，参考 `puzzle-bobble/packages/db/src/schema.ts`。增加 `lockedBy`、`lockedUntil`、`attempts`、`maxAttempts`、`nextRunAt`、`errorJson`。写 Drizzle schema + migration。不改动其他代码。”
2. **P0-2**：”请为 Worker 增加基于 `tasks` 表的 claim 机制和 lock heartbeat，参考 `puzzle-bobble/apps/worker/src/index.ts`。用 `FOR UPDATE SKIP LOCKED` claim task，定期延长 `lockedUntil`，后台 sweep orphan tasks。先只支持 video polling claim。”
3. **P0-3**：”请把 Canvas analyze/characters/locations/refs/storyboard/rebuild 从 server fire-and-forget 迁到 Worker task。每个 phase 作为 task 插入 tasks 表，Worker claim 并执行。Server 只创建 task 并返回 `{ accepted: true, taskId }`。复用现有 service 函数。”
4. **P0-4**：”请统一 Canvas 事件模型：所有状态变化先写库，再 PostgreSQL NOTIFY，再 SSE。移除 server 进程内 `dispatchToUser()` 绕过 DB 的路径。参考 `puzzle-bobble/apps/api/src/modules/pg-listener.ts`。”
5. **P0-5**：”请为 Canvas SSE/Worker 时序补测试：DB 更新先于 notify、orphan 恢复、多 Worker 并发 claim 无重复、auto-run 不依赖前端按钮。”
6. **P1-1**：”请为 Canvas 新增 `/api/canvas/projects/:projectId/assets/poll` 端点，参考 `lumora` 的 `AssetQueryService.getProjectAssetsPoll()`。返回 shots/characters/locations/activeTasks/costs/generatedAt。”
7. **P1-2**：”请将 SSE 降级通用化：通用 hook 支持 `sse | polling | disconnected` 三态，指数退避重连，polling mode 定时调用 asset-centric poll。顶部展示连接状态。参考 `puzzle-bobble/apps/web/src/hooks/use-sse.ts`。”
8. **P1-3**：”请将 Canvas phase 接入已有 reserve/debit/refund 计费链路。Worker 执行前 reserve，成功 debit，失败/取消 refund。”
9. **P2-1**：”请为 `excuse` 建立 TaskTypeRegistry，参考 `lumora/packages/task-engine/src/task-metadata.ts`。优先覆盖 Canvas phase 和 generate/gateway 任务类型。声明 billing/asset/recovery 策略。”
10. **P3-1~P3-6**：按需启动，不阻塞主线。

## 注意事项

- 不建议直接照搬 `puzzle-bobble` 的 Hono 架构到 `excuse`；`excuse` 当前使用 Elysia + Eden treaty，保留即可。
- 不建议直接照搬 `lumora` 的 SQLite 选择；`excuse` 当前 PostgreSQL + Drizzle 更适合 SSE/NOTIFY 和多进程部署。
- 不建议一次性迁移所有 Worker/task/workflow/billing。优先解决 Canvas 可靠性（P0），再做数据层保障（P1），再做元数据治理（P2）。
- `puzzle-bobble` 的前端是控制台风格，不适合作为视觉设计参考；它更适合作为状态展示、模型参数表单和 SSE fallback 的工程参考。
- `lumora` 的多前端拆分适合作为产品边界参考，不一定要立刻把 `excuse` 拆成多个 Vite app。
- `lumora` 的 React Flow 画布实现可以参考数据回显和节点状态，但它自己的产品文档也提醒主创作画布不要完全依赖 React Flow；`excuse` 后续应优先稳定业务状态（P0），再设计更强的导演工作台体验。
- `puzzle-bobble` 的 DB task queue 适合当前规模；如果未来任务量更大，再考虑 Redis/BullMQ/Temporal，不要过早引入重型系统。
- 计费 reserve/debit/refund 已在 `credit.repo.ts` 实现，Canvas 阶段接入即可（P1-3），不需要从零搭建。
- 环境配置治理（P3-6）和模型目录 DB 化（P3-1）改动面较大，建议在 P0/P1 落地后再启动，避免并行改造冲突。
