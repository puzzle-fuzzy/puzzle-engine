# Packages 拆包交接文档（给 Claude）

更新时间：2026-06-14

本文只记录下一轮 Claude 继续处理 `packages` 拆包时的执行路径。不要新建平行整改清单；长期 TODO 仍维护在 `docs/TODO.md`。

## 当前状态

仓库：`/Users/yxswy/Documents/excuse`

当前已经完成的拆包重点：

- `packages/storage`：已从 provider/server 中拆出存储能力。
- `packages/media`：已从 server 中拆出 FFmpeg、字幕、视频合成等媒体能力。
- `packages/subtitle-engine`：已抽出字幕解析、样式、导出相关核心逻辑。
- `packages/workflow-engine`：已承接 workflow/canvas pipeline run 的阶段推进与 task 创建 adapter。
- `packages/canvas-runtime`：已承接 Canvas 图片/视频生成资产生命周期辅助逻辑。
- `packages/task-engine`：已承接任务 handler registry、错误分类、retry decision、成功/失败/重试状态落库 adapter。

最近相关 commit：

- `4b61f9a refactor(canvas-runtime): share canvas video submission`
- `865164f refactor(canvas-runtime): share asset lifecycle helpers`
- `a0b2675 refactor(server): reuse canvas asset lifecycle helper`
- `c158d84 refactor(server): share canvas image asset helpers`
- `d98856c refactor(workflow-engine): create canvas pipeline tasks via adapter`
- `5762b0e refactor(task-engine): share task state adapters`

当前工作区应保持干净。接手前先执行：

```bash
git status --short
```

如果工作区不干净，先判断是否为用户改动，不要回滚用户改动。

## 下一轮目标

继续把 Worker 中与“任务队列执行机制”有关、但不属于具体业务 handler 的逻辑下沉到 `packages/task-engine`。

核心原则：

- `packages/task-engine` 不直接依赖 `@excuse/db`。
- DB 操作通过 adapter 注入。
- Worker 保留运行时编排：加载 config、健康状态、循环、日志、具体 handler dispatch。
- `apps/worker` 不再直接承担任务状态机决策。

## 计划一：抽出 claim / sweep adapter

目标：让 Worker 通过 `task-engine` 领取任务和恢复孤儿任务。

当前直接依赖位置：

- `apps/worker/src/index.ts`
  - `claimNextTask(workerId, config.claimTtlMs)`
  - `sweepOrphanTasks(5)`

DB 实现位置：

- `packages/db/src/repositories/tasks.repo.ts`
  - `claimNextTask`
  - `sweepOrphanTasks`

建议在 `packages/task-engine/src/index.ts` 增加：

```ts
export interface TaskClaimAdapter<TTask> {
  claimNextTask: (workerId: string, claimTtlMs: number) => Promise<TTask | null> | TTask | null
}

export interface ClaimNextTaskWithAdapterInput<TTask> {
  workerId: string
  claimTtlMs: number
  adapter: TaskClaimAdapter<TTask>
}

export async function claimNextTaskWithAdapter<TTask>(
  input: ClaimNextTaskWithAdapterInput<TTask>,
): Promise<TTask | null>
```

再增加 sweep adapter：

```ts
export interface TaskSweepAdapter {
  sweepOrphanTasks: (timeoutMinutes?: number) => Promise<number> | number
}

export interface SweepOrphanTasksWithAdapterInput {
  timeoutMinutes?: number
  adapter: TaskSweepAdapter
}

export async function sweepOrphanTasksWithAdapter(
  input: SweepOrphanTasksWithAdapterInput,
): Promise<number>
```

Worker 改造方向：

- `apps/worker/src/index.ts` 仍从 `@excuse/db` import `claimNextTask` / `sweepOrphanTasks` 作为 adapter 实现。
- Worker 调用 `claimNextTaskWithAdapter` / `sweepOrphanTasksWithAdapter`。
- 不要让 `task-engine` import `@excuse/db`。

需要补测试：

- `packages/task-engine/test/index.test.ts`
  - claim adapter 返回 task 时原样返回。
  - claim adapter 返回 null 时原样返回 null。
  - sweep adapter 透传 `timeoutMinutes`，并返回 recovered count。

建议验证：

```bash
bun test --cwd packages/task-engine
bun run --cwd apps/worker typecheck
bun test --cwd apps/worker
bun run lint
```

建议 commit：

```bash
git add packages/task-engine/src/index.ts packages/task-engine/test/index.test.ts apps/worker/src/index.ts docs/TODO.md
git commit -m "refactor(task-engine): share task claim adapters"
```

同时更新 `docs/TODO.md` 中 package 拆包条目，标注 claim/sweep adapter 已完成和 commit hash。

## 计划二：抽出 heartbeat / lock extension adapter

目标：让 heartbeat 的“何时续锁、续锁失败如何停止”成为 task-engine 能测试的通用逻辑。

当前位置：

- `apps/worker/src/heartbeat.ts`
  - 直接 import `extendTaskLock` from `@excuse/db`
  - `startTaskHeartbeat(taskId, workerId, claimTtlMs)`

DB 实现位置：

- `packages/db/src/repositories/tasks.repo.ts`
  - `extendTaskLock`

建议做法：

1. 在 `task-engine` 增加纯 adapter contract：

```ts
export interface TaskHeartbeatAdapter<TTask> {
  extendTaskLock: (id: string, workerId: string, claimTtlMs: number) => Promise<TTask | null> | TTask | null
}

export interface ExtendTaskLockWithAdapterInput<TTask> {
  taskId: string
  workerId: string
  claimTtlMs: number
  adapter: TaskHeartbeatAdapter<TTask>
}

export async function extendTaskLockWithAdapter<TTask>(
  input: ExtendTaskLockWithAdapterInput<TTask>,
): Promise<TTask | null>
```

2. `apps/worker/src/heartbeat.ts` 改成接收 adapter：

```ts
export function startTaskHeartbeat(
  taskId: string,
  workerId: string,
  claimTtlMs: number,
  adapter: TaskHeartbeatAdapter<unknown>,
): () => void
```

3. `apps/worker/src/index.ts` 调用时传入：

```ts
const stopHeartbeat = startTaskHeartbeat(claimedTask.id, workerId, config.claimTtlMs, {
  extendTaskLock,
})
```

注意：

- 如果 `heartbeat.ts` 继续保留 logger 是可以接受的，它属于 worker 运行时行为。
- 不要把 setInterval 搬进 `task-engine`，除非同步补可控 timer 测试。优先只抽续锁 adapter。

需要补测试：

- `packages/task-engine/test/index.test.ts`
  - `extendTaskLockWithAdapter` 传入 taskId/workerId/claimTtlMs。
  - adapter 返回 null 时函数返回 null。

建议验证：

```bash
bun test --cwd packages/task-engine
bun run --cwd apps/worker typecheck
bun test --cwd apps/worker
bun run lint
```

建议 commit：

```bash
git add packages/task-engine/src/index.ts packages/task-engine/test/index.test.ts apps/worker/src/heartbeat.ts apps/worker/src/index.ts docs/TODO.md
git commit -m "refactor(task-engine): share task heartbeat adapter"
```

## 计划三：抽出 cancel / release adapter

目标：把任务取消状态转换从 server/canvas route 的散落调用中收口到 task-engine adapter。

当前直接依赖位置：

- `apps/server/src/routes/canvas.ts`
  - `cancelTask(cancelled.taskId)`
  - `cancelActiveCanvasAssetsByProject(projectId)`
  - `markPipelineRunCancelled(run.id)`
- `apps/server/src/modules/generation/service.ts`
  - provider cancel
  - `cancelGenerationRecord(recordId)`

DB 实现位置：

- `packages/db/src/repositories/tasks.repo.ts`
  - `cancelTask`
  - `releaseTaskLock`

建议优先只处理 `tasks` 的取消，不要一次性把 generation_records/provider cancel 也混进来。

建议在 `task-engine` 增加：

```ts
export interface TaskCancelAdapter<TTask> {
  cancelTask: (id: string) => Promise<TTask | null> | TTask | null
}

export interface CancelTaskWithAdapterInput<TTask> {
  taskId: string
  adapter: TaskCancelAdapter<TTask>
}

export async function cancelTaskWithAdapter<TTask>(
  input: CancelTaskWithAdapterInput<TTask>,
): Promise<TTask | null>
```

如果需要释放锁，再单独加：

```ts
export interface TaskReleaseLockAdapter {
  releaseTaskLock: (id: string) => Promise<unknown> | unknown
}
```

注意：

- Canvas 取消阶段里还涉及 pipeline run 和 canvas assets，这些属于 canvas/workflow 业务边界，不要硬塞进 `task-engine`。
- `task-engine` 只负责 task 的取消动作，外层 route 仍负责“取消哪个 run / 哪些资产”。

建议验证：

```bash
bun test --cwd packages/task-engine
bun run --cwd apps/server typecheck
bun test apps/server/test/canvas-routes*.test.ts
bun run lint
```

建议 commit：

```bash
git add packages/task-engine/src/index.ts packages/task-engine/test/index.test.ts apps/server/src/routes/canvas.ts docs/TODO.md
git commit -m "refactor(task-engine): share task cancel adapter"
```

## 计划四：收口 Worker 动态 import

当前 `apps/worker/src/index.ts` 在任务失败后仍有动态 import：

```ts
const { notifyTaskStatusChange, getTaskById } = await import('@excuse/db')
const updatedTask = await getTaskById(claimedTask.id)
if (updatedTask) {
  await notifyTaskStatusChange(updatedTask)
}
```

建议处理方式：

- 先在文件顶部静态 import `getTaskById`、`notifyTaskStatusChange`。
- 再判断是否需要在 `task-engine` 增加失败后 notify helper。
- 如果只是消除动态 import，可以单独做一个小 commit。

注意：

- 不要为了消除 dynamic import 把 `getTaskById` 强行放到 `task-engine`。
- 如果要抽，仍然通过 adapter，例如 `fetchTaskById` + `notifyTaskStatusChange`。

建议 commit：

```bash
git add apps/worker/src/index.ts docs/TODO.md
git commit -m "refactor(worker): remove task status dynamic import"
```

## 暂时不要做的事

- 不要把 `pollPendingVideoTasks`、ASR、Export 全部塞进 `task-engine`。它们仍是旧 generation_records / subtitle 项目轮询路径，应该单独设计迁移，不要和 tasks 表拆包混在一起。
- 不要把 Canvas 业务阶段 handler 放进 `task-engine`。Canvas 阶段属于 `canvas-runtime` / `workflow-engine` / worker handlers 的边界。
- 不要在 `packages/task-engine` 里 import `@excuse/db`、`@excuse/provider`、`@excuse/canvas-runtime`。
- 不要新增“项目整改总清单”等平行清单。

## 推荐提交节奏

每完成一个 package 边界就提交一次：

1. `refactor(task-engine): share task claim adapters`
2. `refactor(task-engine): share task heartbeat adapter`
3. `refactor(task-engine): share task cancel adapter`
4. `refactor(worker): remove task status dynamic import`

每个 commit 前至少运行对应 package 和受影响 app 的 typecheck/test。每个 commit 后更新 `docs/TODO.md` 的完成状态和 commit hash。

## 最终验收口径

这一轮完成后，应该达到：

- `apps/worker/src/index.ts` 中任务 claim/sweep/success/failure/retry 的状态机动作都通过 `task-engine` adapter 进入。
- `apps/worker/src/heartbeat.ts` 不再直接依赖 `@excuse/db`。
- `apps/server/src/routes/canvas.ts` 的 task 取消动作通过 `task-engine` adapter 调用。
- `packages/task-engine` 仍是纯业务规则/adapter contract package，不依赖 DB 和 provider。
- `bun test --cwd packages/task-engine`、`bun run --cwd apps/worker typecheck`、`bun test --cwd apps/worker`、`bun run --cwd apps/server typecheck`、`bun run lint` 通过。
