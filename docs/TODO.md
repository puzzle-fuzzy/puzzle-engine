# 项目统一 TODO

更新时间：2026-06-13

本文是 `excuse` 后续产品迭代、技术治理和验收标准的唯一入口。后续 Claude / Codex 只处理本文，不再拆分处理多份清单。

历史内容已合并到本文。后续只维护本文，不再创建或引用已经删除的平行清单、参考文档。

参考来源：

- `/Users/yxswy/Documents/puzzle-bobble`
- `/Users/yxswy/Documents/unknown/lumora`

## 使用规则

- 本文只记录当前仍需推进或需要明确验收的事项。
- 已完成事项必须明确标注“已完成”，并记录对应 commit，例如：`状态：已完成，commit：abc1234`。
- 已完成事项可以保留简短结论，不再展开成执行任务。
- 每完成一个独立待办，必须同步更新本文，并为该项提交对应 git commit。
- 不要让两个 Claude 分别修改不同清单；所有产品和技术任务都统一落到本文。
- 不要再新增平行清单或参考文档，避免多份文档互相影响。

## 治理原则

- 项目尚未上线，不需要兼容历史脏数据或旧接口形态。
- TypeScript 类型要完整，尽可能减少 `any` / `unknown` / 裸 `Record<string, unknown>`。
- 测试要覆盖真实风险，不用脆弱断言或噪声日志掩盖问题。
- 架构设计优先，跨模块边界必须有明确 DTO、parser 或 domain type。
- 文件职责要清晰，避免一个文件承担过多业务分支。
- 核心功能需要有必要注释，尤其是异步流程、计费、SSE、去重、权限和外部 provider 边界。
- 生成过程要产品化为可见、可恢复、可重试的生产流程。
- 生成结果要沉淀为资产，而不是临时 task output。
- API Key、Gateway、Billing 等商业化能力要有独立产品边界，不应半开放。

## 当前总判断

`excuse` 后续最重要的方向不是继续堆更多生成按钮，而是从“AI 内容生成工具”升级为“AI 创作生产平台”。

当前最关键的问题集中在三类：

- Canvas 自动执行、SSE、图片/视频回显仍需要继续产品化和工程化收口。
- Credit、Notification、Audit、OpenAI Gateway、Metrics、API Key 等产品化能力仍需要明确开放状态和验收口径。
- 资产中心、Model Lab、管理后台、开发者中心属于后续增强，不应抢在 Canvas 主体验之前。

## 已完成的工程阻塞项

以下事项已完成，不应作为新的待办重复处理。

### 1. Lint 阻塞已完成

状态：已完成，commit：`52284e2`

完成内容：

- `SubtitleEditor.tsx`：将单个 `useEffect` 拆分为句子同步和样式同步两个 effect，补齐依赖。
- `subtitle/service.ts`：展开单行 `try { await ... } catch {}`。
- `subtitle-burner.ts`：展开两处单行 `try-catch`。

验证结果：

- `bun run lint` 通过，0 errors，0 warnings。

### 2. Server SSE Manager 测试阻塞已完成

状态：已完成，commit：`1c72a0c`

完成内容：

- 移除 `notifications-routes.test.ts` 中污染全局模块的 `sse-manager` mock。
- 修复 `sse-manager.test.ts` 中 `dispatchToUser` 多连接测试被 mock 干扰的问题。

验证结果：

- `bun run test` 通过，262 pass，0 fail。

### 3. 测试代码 `as any` 阻塞已完成

状态：已完成，commit：`4232701`

完成内容：

- 新增 `MockGenerationRecord` 接口。
- 替换 `dbState.records` 的松散数组类型。
- 消除 `apps/server/test/subtitle-service.test.ts` 中实际类型逃逸。

验证结果：

- `rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages` 中无实际类型逃逸，只剩注释说明。

## P0：Canvas 可信赖创作工作台

目标：用户点击自动执行后，不刷新页面也能看到真实进度、图片、视频、失败项和最终状态。

### 1. 自动执行体验

待办：

- 将“自动执行全部”从前端连续调用接口，逐步迁移为后端/worker 驱动的 pipeline run。
- 前端点击自动执行后，只创建或启动一次 run。
- 每个阶段都有明确状态：等待中、生成中、已完成、失败、已取消。
- 页面刷新后能继续看到真实 run 状态。
- 支持暂停、继续、终止、重试失败阶段。

验收：

- 用户刷新页面不会丢失自动执行状态。
- 某一阶段失败后，不影响用户看到已完成产物。
- 失败项可以单独重试。

### 2. 图片和视频实时回显

待办：

- 为 Canvas 增加统一资产轮询接口，例如 `/api/canvas/projects/:projectId/assets/poll`。
- 接口返回 `assets`、`bindings`、`activeTasks`、`costs`、`projectStatus`、`generatedAt`。
- 前端收到 SSE 后调用轮询接口刷新真实数据。
- SSE 断开或漏事件时，前端自动进入 polling fallback。
- 画布和镜头列表都以资产绑定结果为准，不直接依赖 task output。

验收：

- 图片生成完成后无需刷新即可显示。
- 视频生成完成后无需刷新即可播放。
- 终止任务后页面能自动停止 loading，并显示取消或失败状态。
- SSE 不可用时，轮询仍能让页面最终收敛到正确状态。

### 3. Canvas 产物资产化

待办：

- 角色参考图、场景参考图、镜头图、镜头视频、最终视频都应进入统一资产模型。
- shot、character、location 保存当前选中 asset 或 URL 快照。
- 同一镜头多次生成时保留历史资产。
- 用户可以选择、替换、锁定满意资产。
- 资产记录区分 provider 临时 URL、前端可访问 URL、provider 可复用 URL。

验收：

- 用户能查看同一镜头的历史图片和历史视频。
- 用户能锁定满意角色图或场景图，后续生成不会自动覆盖。
- 后续 I2V/R2V 能稳定使用已有参考图。

### 4. 用户可理解的状态面板

待办：

- Canvas 顶部显示当前阶段、已完成数量、失败数量、进行中数量。
- 显示连接状态：SSE 正常、轮询中、已断开、最后更新时间。
- 增加任务队列面板：任务类型、目标对象、状态、重试次数、错误摘要。
- 增加失败原因和下一步建议。

验收：

- 用户不用打开控制台，也能知道当前卡在哪里。
- 失败不只显示“失败”，还要说明是 provider、网络、存储、余额、取消或系统错误。

## P1：资产中心和创作资产复用

目标：让生成结果从一次性输出变成可管理、可复用、可组合的创作资产。

### 1. 资产中心升级

待办：

- 按图片、视频、上传文件、角色、场景、镜头、最终视频分类浏览。
- 支持按项目、时间、模型、状态筛选。
- 支持预览、下载、删除、复制链接。
- 支持查看资产来源任务、prompt、模型、成本。

验收：

- 用户能找到之前生成过的素材。
- 用户能从资产中心回到对应 Canvas 项目或镜头。

### 2. 参考资产复用

待办：

- 镜头生成时支持选择多个参考资产。
- 参考资产标注角色：角色图、场景图、风格图、首帧图、其他。
- 根据参考资产数量自动推荐 T2V/I2V/R2V 模型。
- 支持将资产应用到一个镜头、一组镜头或整个项目。

验收：

- 用户能明确知道当前镜头用了哪些参考图。
- 多参考图生成视频时，模型选择不会出现明显不兼容。

## P2：产品化能力决策和验收

目标：让 Credit、Notification、Audit、OpenAI Gateway、Metrics、API Key 不再只是工程骨架，而是有明确产品状态和验收闭环。

### 1. Credit 计费闭环

当前状态：部分完成。

已完成：

- 普通 `/api/generate` 主流程已接入预估费用、`reserveCredit`、成功扣费和失败退款。
- retry 流程已重新 reserve。
- worker 处理异步视频任务时，成功会 debit，失败或超时会 refund。
- OpenAI Gateway 已接入 reserve、debit、refund。
- `packages/db/src/repositories/credit.repo.ts` 已具备余额、reserve、debit、refund、交易幂等和 usage event 记录能力。

未完成：

- Canvas 的文本分析、角色提取、场景提取、参考图生成、分镜、连续性重建等阶段仍直接调用 provider，没有完整 credit reserve/debit/refund 闭环。
- Canvas 视频阶段主要依赖生成记录和 worker 结算，但前置阶段的成本没有统一进入 credit 体系。
- Canvas 任务缺少面向用户的预估成本、实际扣费、失败退款说明。
- 缺少覆盖 Canvas 全链路计费的端到端测试。

决策项：

- 决定 Canvas 前置阶段是否上线即收费。
- 如果收费，需要为每个 Canvas provider 调用建立统一的 cost estimate、reserve、debit、refund 策略。
- 如果暂不收费，需要明确标注为 beta/free quota，不要让 credit 数据误导用户。

完成定义：

- 所有上线收费路径都能证明 reserve、debit、refund 三段闭环。
- Canvas 收费策略有明确产品结论。
- 用户能回答“这次自动生成大概花了多少钱”。
- 用户能看到失败任务是否扣费或退款。
- 对失败、取消、超时、重复回调都有测试覆盖。

### 2. Notification 真实触发器

当前状态：基础能力存在，业务触发不足。

已完成：

- notifications route 已支持列表、未读数、标记已读、全部已读。
- `pushNotification()` 可以创建持久通知并通过 SSE 推送。
- 前端 Navbar 已有通知铃铛和未读数展示。

未完成：

- 生产业务中缺少真实触发器，任务成功、任务失败、Canvas 阶段完成、余额不足、API Key 风险事件等还没有系统调用 `pushNotification()`。
- 通知点击后还没有系统定位到对应项目、任务或资产。
- 缺少通知触发、未读数刷新、SSE 通知同步的端到端测试。

决策项：

- 明确第一批必须推送的通知类型。
- 决定通知是否只用于用户可见事件，还是也覆盖系统风险事件。

完成定义：

- 至少覆盖任务成功、任务失败、Canvas 全部完成、余额不足四类真实通知。
- 前端不用刷新即可看到未读数变化。
- 用户不在 Canvas 页面时，也能知道生成完成或失败。
- 通知点击后能定位到具体问题或产物。

### 3. Audit 关键动作覆盖

当前状态：部分覆盖。

已完成：

- 注册、登录已有 audit。
- 上传文件删除已有 audit。
- 普通生成任务已有 audit。
- API Key 创建和撤销已有 audit。

未完成：

- Canvas 项目创建、删除、阶段执行、批量自动执行、终止等关键动作没有系统覆盖。
- OpenAI Gateway 调用没有明确 audit 记录。
- credit reserve/debit/refund 等资金相关动作没有形成完整 audit 视图。
- notification 读取、全部已读等用户行为没有审计决策。
- 取消、重试等生成任务状态变更覆盖不足。

决策项：

- 明确哪些行为必须审计，哪些只需要日志。
- 明确 audit 是否用于后台安全追踪，还是也要进入管理后台。

完成定义：

- 权限、资金、外部 provider 调用、资源删除、批量自动化动作均有审计策略。
- 每类必须审计动作都有测试。
- audit payload 使用明确 DTO，不落入随意 JSON 堆叠。

### 4. OpenAI Gateway 产品状态

当前状态：API 已暴露，产品决策未完成。

已完成：

- `/v1/models` 和 `/v1/chat/completions` 已挂载。
- 支持 API Key/JWT 鉴权。
- 已接入 credit reserve、debit、refund。
- 基础兼容 OpenAI Chat Completions 请求形态。

未完成：

- 不支持 streaming。
- 目前主要支持文本对话，能力边界需要写清楚。
- 没有前端入口、开发者中心或文档入口。
- 尚未决定近期是否作为正式产品能力开放。

决策项：

- 如果正式开放，需要补齐 API 文档、示例、错误码、限流策略、流式响应、开发者中心。
- 如果内测隐藏，需要文档标注 beta/internal，并限制入口。
- 如果暂缓关闭，需要确保普通用户没有入口，并在部署层明确是否暴露 `/v1`。

完成定义：

- 明确标记为“正式开放 / 内测隐藏 / 暂缓关闭”之一。
- 如果正式开放，需要有文档、测试、限流、计费、错误处理、streaming 决策和用量查询。
- 如果隐藏或暂缓，需要确认前端、文档和部署入口都不误导用户。
- 不出现“后端已经暴露，但用户看不懂怎么用”的半成品状态。

### 5. Metrics / Health 部署可观测性

当前状态：开发级可用，生产级不足。

已完成：

- server 有 health 和基础 metrics route。
- worker 有独立 health。
- 已能观察基础请求、SSE 在线、worker 轮询状态等信息。

未完成：

- metrics 主要是内存态，重启后丢失，不适合多实例聚合。
- 缺少 Prometheus 或类似标准格式。
- 缺少 provider 错误率、模型耗时、任务队列积压、Canvas 阶段耗时等关键指标。
- metrics route 是否需要鉴权还未决策。

决策项：

- 决定上线前是否引入 Prometheus 格式指标。
- 决定 metrics 是否只给内网访问，还是需要鉴权。
- 明确最低部署观测指标清单。

完成定义：

- 部署时能回答服务是否存活、DB 是否可用、worker 是否工作、任务是否积压、provider 是否异常。
- metrics 暴露策略明确，不泄露敏感信息。
- 有一组可复制的线上排障检查命令或文档。

### 6. API Key 产品化

当前状态：后端能力可用，前端产品化不足。

已完成：

- API Key route 已支持创建、列表、撤销。
- bearer token 中的 `exc_` API Key 能进入认证链路。
- API Key 创建和撤销已有 audit。

未完成：

- 前端没有 API Key 管理入口。
- 缺少密钥只展示一次、复制、命名、撤销确认等产品体验验收。
- API Key 权限范围、速率限制和使用统计还不完整。

决策项：

- 决定 API Key 是否随 OpenAI Gateway 一起开放。
- 决定是否需要 scoped key，例如只允许 gateway、只允许生成、只读统计等。

完成定义：

- 如果开放，需要前端管理页、创建后只显示一次、复制、撤销确认、使用说明和限流策略。
- 如果开放，需要支持 key 命名、撤销、scope、rate limit、quota。
- 如果不开放，需要隐藏入口，并保留后端仅供内部或测试使用。

## P3：Model Lab、管理后台和运营能力

目标：提升内部模型调试效率，并为后续商业化运营准备后台能力。

### 1. Model Lab

待办：

- 增加内部模型实验页。
- 支持测试文本、图片、视频模型。
- 支持参数表单、prompt 输入、结果预览、成本显示。
- 支持保存测试结果，并一键复用到 Canvas 默认配置。
- 支持同 prompt 多模型对比。

验收：

- 新模型接入时可以先在 Model Lab 验证，不污染正式 Canvas 流程。
- 运营或开发能比较模型质量和成本。

### 2. 管理后台

待办：

- 项目和任务检索。
- 用户、余额、用量、成本统计。
- 失败任务诊断。
- provider 错误率和模型成本统计。
- API Key 和 Gateway 客户管理。

验收：

- 出现用户问题时，运营能定位任务、资产、扣费、错误原因。
- 可以按模型、用户、项目维度查看成本。

## 参考项目迁移指南

本节合并自历史参考材料。后续 Claude 不需要再打开其他参考文档，只需要按本文执行。

### 1. 总体参考判断

`puzzle-bobble` 更适合作为工程可靠性参考：

- 长任务状态机与可靠任务队列。
- workflow run / step / task 抽象。
- SSE 与 PostgreSQL NOTIFY 事件模型。
- 预授权、结算、退款的计费事务边界。
- 模型目录、能力、定价、参数 schema 治理。
- Worker 健康检查、锁续期、孤儿任务恢复、重试分类。

`lumora` 更适合作为产品平台化参考：

- creative、model-lab、admin、customer、gateway 多产品线边界。
- 统一资产轮询契约：`assets`、`bindings`、`activeTasks`、`costs`。
- API Gateway 的 customer、key、scope、quota、rate limit、usage、credit ledger 闭环。
- `TaskTypeRegistry` 为每类任务声明 billing、asset、recovery 策略。
- `WorkflowStepper` 将自动执行从前端按钮链路转移到 worker orchestration。

### 2. Monorepo 分层与 shared/core

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/types.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/db/src/schema.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/core/src/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/web-api-client/src/types.ts`

迁移建议：

- 强化 `packages/shared`，集中维护 Canvas phase、shot status、pipeline run status、SSE event type、task type。
- DB enum、API DTO、前端类型不要各自重复定义。
- 跨 app 的业务协议优先放 shared/core，再由 DB schema 和前端派生。

### 3. 环境配置治理

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/config/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/config/src/runtime-path.ts`

迁移建议：

- 用 Zod 统一校验 server、worker、provider、storage、cors、rateLimit、retention 配置。
- 生产环境禁止默认 `JWT_SECRET`、默认 DB、默认开放 CORS。
- 对 DashScope、OSS、OpenAI-compatible gateway 做跨字段校验。

### 4. 错误码与 API 响应

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/errors.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/common.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/errors.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/projects/errors.ts`

迁移建议：

- 建立稳定 `ErrorCode` registry。
- 统一处理 AppError、ZodError、JSON SyntaxError 和未知错误。
- API 不要混用 `{ success: false }`、`{ error }`、`{ data }` 多种形态。
- Gateway 对外错误码必须稳定，不能泄露 provider 原始敏感 payload。

### 5. Worker 任务队列可靠性

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/retry.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/task-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.ts`

迁移建议：

- 新增统一 `tasks` 表，或将现有 generation records/task polling 泛化。
- task 需要 `queued/running/retrying/succeeded/failed/canceled` 状态。
- 增加 `attempts`、`maxAttempts`、`nextRunAt`、`lockedBy`、`lockedUntil`、`errorJson`。
- Worker 使用 claim 机制，避免多个 worker 抢同一任务。
- 长任务需要 lock heartbeat，worker 崩溃后 orphan sweep 恢复。
- Canvas analyze、characters、locations、refs、storyboard、prompts、videos 都应从 server fire-and-forget 迁到 worker task。

### 6. Workflow Run / Step / Task

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/pipeline.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/task-creation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/orchestrator.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/workflow-engine/src/stepper.test.ts`

迁移建议：

- `canvas_pipeline_runs` 作为 workflow run。
- 增加或强化 `canvas_pipeline_steps`：`phaseKey`、`status`、`taskIds`、`startedAt`、`finishedAt`、`errorJson`。
- 自动执行全部由 worker/stepper 推进，不由前端逐个调用接口。
- step 成功后推进下一步；失败时支持重试、跳过、取消。
- batch step 允许部分成功继续，但必须记录 failed tasks。

### 7. SSE 与 PostgreSQL NOTIFY

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/pg-listener.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/projects/sse.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/lib/sse.ts`

迁移建议：

- 所有状态变化必须先写库，再 NOTIFY，再 SSE。
- SSE 只通知“有变化”，真实数据以 poll/detail 接口为准。
- 事件 payload 需要包含 `projectId`、`phase`、`taskId`、`status`、`updatedAt`。
- 前端需要展示 `sse | polling | disconnected` 连接状态。
- SSE 断开后自动进入 polling fallback。

### 8. 通知系统与状态事件解耦

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/notifications.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/events.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/测试策略与验收矩阵.md`

迁移建议：

- domain event 和 user notification 分开。
- 任务状态变化先产生 domain event，再由 notification policy 决定是否生成用户通知。
- 第一批通知覆盖：任务成功、任务失败、Canvas 全部完成、余额不足。
- 通知应能跳转到项目、任务或资产。

### 9. Credit 预授权、扣费、退款和幂等

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/task-creation.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/complete.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/credit-ledger/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/billing.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/service.ts`

迁移建议：

- 所有收费任务遵循 reserve -> execute provider -> debit/refund。
- reservation 失败时任务不能继续执行。
- provider 成功但结算失败，不能再错误 refund。
- debit/refund 需要按 taskId 幂等。
- Canvas 前置阶段是否收费必须先做产品决策。

### 10. 模型目录、能力和价格治理

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/billing/src/model-catalog.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/providers.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/index.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/types.ts`
- `/Users/yxswy/Documents/unknown/lumora/packages/model-registry/src/models/bailian.ts`

迁移建议：

- 在 `packages/provider/src/model-configs.ts` 之外增加能力层。
- 每个模型声明 `inputModes`、`maxInputImages`、`supportedRatios`、`durationRange`、`supportsPromptExtend`。
- Canvas 生成视频时根据参考资产数量自动推荐 T2V/I2V/R2V。
- 后端二次校验模型能力，避免前端绕过导致 provider error。

### 11. Provider 能力与任务处理器

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/handlers.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/providers.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-image.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/handlers/shot-generate-video.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/media-generation.ts`

迁移建议：

- provider adapter 只负责调用外部模型，不处理业务状态。
- worker handler 负责读取 input、调用 provider、保存资产、更新业务实体、结算计费。
- cancel-aware polling 要成为通用工具。
- provider 空结果、异常结构、超时都必须有明确错误码。

### 12. 资产生成链路与资产轮询

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/creative/src/assets.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/资产轮询与成本回显契约.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/asset-persistence.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/hooks.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/components/ShotCard.tsx`

迁移建议：

- Canvas 结果不要直接依赖 task output。
- 新增 asset-centric polling：`assets`、`bindings`、`activeTasks`、`costs`。
- 角色图、场景图、镜头图、镜头视频、最终视频都应创建 asset。
- 同一镜头多次生成要保留历史资产。
- 存储字段区分 `sourceUrl`、`publicUrl`、`providerUrl`、`localPath`。
- OSS 上传失败不应阻塞 asset 创建，但要记录 metadata。

### 13. 前端体验参考

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/model-selector.tsx`
- `/Users/yxswy/Documents/puzzle-bobble/apps/web/src/components/task-list.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/pages/FlowPage.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/creative-web/src/features/projects/components/TaskPanel.tsx`
- `/Users/yxswy/Documents/unknown/lumora/apps/customer-web/src/features/customer/pages/CustomerKeysPage.tsx`

迁移建议：

- Canvas 顶部展示当前阶段、进行中数量、失败数量、最后更新时间。
- 任务面板展示 task type、target、status、model、retry、error。
- 镜头卡片展示当前图片/视频、历史资产、参考图、生成状态。
- API Key 若开放，secret 只显示一次，支持复制、prefix、状态、限流、额度、最近使用。

### 14. 测试体系与可注入设计

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/packages/config/src/index.test.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/*.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/docs/operations/测试策略与验收矩阵.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/assets/asset-query-service.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/money-flow.test.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/services/task-recovery.test.ts`

迁移建议：

- Worker handler 使用依赖注入，不直接 import 全局 DB/provider。
- Canvas SSE 测试覆盖事件漏发、重复事件、断线重连、polling fallback。
- 计费测试覆盖余额不足、预占、扣费、退款、恢复不重复扣费。
- 资产测试覆盖 provider 成功但文件持久化失败、OSS 上传失败、重复恢复不重复建资产。
- 权限测试覆盖客户只能看自己的 key、余额、流水、任务、资产。

### 15. 运维与健康检查

参考文件：

- `/Users/yxswy/Documents/puzzle-bobble/apps/worker/src/index.ts`
- `/Users/yxswy/Documents/puzzle-bobble/packages/core/src/metrics.ts`
- `/Users/yxswy/Documents/puzzle-bobble/apps/api/src/modules/api-metrics.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/worker/src/index.ts`

迁移建议：

- Worker health 返回 workerId、running、lastActiveAt、tasksProcessed、database、storage、uptime、memory。
- Server/worker 都输出 version、db 状态、storage 状态。
- metrics 增加 SSE 连接数、任务处理数、失败数、平均耗时、provider error count。
- shutdown 时停止接新任务，等待当前任务完成或留给 recovery。

### 16. API Gateway 产品化参考

参考文件：

- `/Users/yxswy/Documents/unknown/lumora/docs/product/API网关产品设计.md`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/proxy-routes.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/service.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/api/src/modules/gateway/quota.ts`
- `/Users/yxswy/Documents/unknown/lumora/apps/customer-web/src/features/customer/pages/CustomerKeysPage.tsx`

迁移建议：

- Gateway 必须明确为正式开放、内测隐藏、暂缓关闭之一。
- 如果开放，需要开发者中心：API Key、余额、用量、流水、任务、调用示例。
- Key 支持 scope、rate limit、daily quota、monthly quota、status、lastUsedAt。
- 客户只能查询自己的 key、usage、transactions、tasks。

### 17. Claude 执行提示

后续可以按以下提示拆任务给 Claude：

1. “请只参考 `docs/TODO.md`，不要再读取其他清单或参考文档。”
2. “请先为 Canvas 设计并实现 `assets/bindings/activeTasks/costs` 轮询接口，保持 SSE 只作为变化通知。”
3. “请为 Canvas 前端增加 `sse | polling | disconnected` 模式，SSE 收到事件后刷新 poll 数据。”
4. “请设计 `tasks` 表和 Worker claim 机制，先只支持 Canvas phase task。”
5. “请建立 Canvas `TaskDefinition` 注册表，为每类任务声明 billing/asset/recovery 策略。”
6. “请把 Canvas analyze/characters/locations/storyboard/rebuild 从 server fire-and-forget 迁到 Worker task。”
7. “请引入 workflow step 抽象，让自动执行全部由后端 orchestrator 推进，而不是前端逐步调用接口。”
8. “请决定 OpenAI Gateway 是正式开放、内测隐藏还是暂缓关闭，并补对应文档和入口处理。”

### 18. 注意事项

- 不建议直接照搬 `puzzle-bobble` 的框架形态；`excuse` 当前使用 Elysia + Eden treaty，保留即可。
- 不建议直接照搬 `lumora` 的 SQLite；`excuse` 当前 PostgreSQL + Drizzle 更适合 SSE/NOTIFY 和多进程部署。
- 不建议一次性迁移所有 Worker/task/workflow/billing；优先解决 Canvas 可靠性。
- 不建议立刻把 `excuse` 拆成多个 Vite app；先拆清产品边界和路由边界。
- `lumora` 的 React Flow 页面可参考数据回显，不代表 Canvas 主体验必须使用 React Flow。
- 如果未来任务量更大，再考虑 Redis/BullMQ/Temporal，不要过早引入重型系统。

## 暂不建议做的事

- 不建议立刻拆成多个前端应用；先拆清产品边界和路由边界。
- 不建议先做复杂支付、发票、套餐；先把成本展示和 credit 闭环做可靠。
- 不建议继续只修补单个 SSE 事件；应补统一资产轮询和 pipeline run 状态。
- 不建议把 API Gateway 半开放给普通用户；要么隐藏，要么补完整开发者中心。
- 不建议把 Canvas 做成自由流程图编辑器；当前优先做稳定、清晰、可控的导演工作台。

## 推荐执行顺序

1. Canvas 统一资产轮询接口。
2. 前端 SSE + polling fallback。
3. 自动执行全部迁移为 pipeline run / step / task。
4. 角色、场景、镜头资产化和历史资产展示。
5. Canvas 成本回显和失败/退款说明。
6. Notification 真实触发器。
7. 对 OpenAI Gateway、API Key、Notification 做产品开放决策。
8. 明确 Canvas 前置阶段是否收费，并补齐 credit 策略。
9. 补齐必须上线能力的端到端测试。
10. 整理部署可观测性文档和 metrics 暴露策略。
11. Model Lab 内部实验页。
12. 管理后台和运营统计。

## 验收命令

每轮整改后至少运行：

```bash
bun run typecheck
bun run lint
bun run build
bun run test
bun run test:client
bun run test:db
rg -n "\bas any\b|@ts-ignore|@ts-expect-error" apps packages
```

完成定义：

- 上述命令全部通过。
- `rg any` 只允许出现在注释说明、tsconfig 模板注释或第三方声明不可控场景，测试代码不例外。
- 跨模块边界必须有明确 DTO/parser/domain type 和能失败的测试。
- 每个独立待办完成后，必须提交对应 git commit，不混入其他待办。
