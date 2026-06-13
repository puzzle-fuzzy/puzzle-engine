/**
 * Pipeline Stepper — Canvas 自动执行阶段推进器
 *
 * Worker 完成当前 phase task 后，如果项目的 autoProgress=true，
 * 自动创建下一个 phase 的 pipeline_run + task。
 *
 * 暂停阶段（storyboard、videos）不自动推进，需要用户确认。
 *
 * PHASE_ORDER 定义了 9 个阶段的严格顺序。
 * PAUSE_BEFORE 定义了需要用户确认才能继续的阶段。
 */

import type { CanvasPipelinePhase } from '@excuse/db'
import type { WorkerConfig } from './config'
import {
  createPipelineRun,
  createTask,
  findActiveRunForPhase,
  getCanvasProjectById,
  linkPipelineRunToTask,
} from '@excuse/db'
import { createLogger } from '@excuse/shared'

const logger = createLogger('pipeline-stepper')

/** 9 个阶段的严格顺序 */
export const PHASE_ORDER: CanvasPipelinePhase[] = [
  'analyze',
  'characters',
  'locations',
  'characterRefs',
  'locationRefs',
  'storyboard',
  'continuity',
  'rebuild',
  'videos',
]

/** 需要用户确认才能继续的阶段 — 自动执行到此暂停 */
export const PAUSE_BEFORE: Set<CanvasPipelinePhase> = new Set([
  'storyboard', // 分镜脚本：用户可能想手动调整角色/场景后再生成分镜
  'videos', // 视频生成：用户可能想确认提示词后再开始耗时视频生成
])

/** Canvas phase → task type 映射 */
function phaseToTaskType(phase: CanvasPipelinePhase): string {
  return `canvas.${phase}`
}

/** 获取当前 phase 在 PHASE_ORDER 中的下一个 phase */
function getNextPhase(currentPhase: CanvasPipelinePhase): CanvasPipelinePhase | null {
  const index = PHASE_ORDER.indexOf(currentPhase)
  if (index === -1 || index === PHASE_ORDER.length - 1)
    return null
  return PHASE_ORDER[index + 1]!
}

/**
 * Worker task 完成后，检查是否应自动推进到下一个 pipeline phase
 *
 * 推进条件：
 *   1. task.domain === 'canvas'
 *   2. task.projectId 存在
 *   3. 项目的 modelPreferencesJson.autoProgress === true
 *   4. 下一个 phase 不在 PAUSE_BEFORE 中
 *   5. 下一个 phase 没有 active run（并发守卫）
 *
 * @returns 创建的 task ID（如果推进成功），null（如果不推进）
 */
export async function advancePipelineAfterTaskSuccess(
  task: { id: string, type: string, domain: string, projectId: string | null, accountId: string | null },
  workerConfig: WorkerConfig,
): Promise<string | null> {
  // 1. 只处理 canvas domain 的 task
  if (task.domain !== 'canvas' || !task.projectId || !task.accountId)
    return null

  // 2. 提取当前 phase
  const currentPhase = task.type.replace('canvas.', '') as CanvasPipelinePhase
  if (!PHASE_ORDER.includes(currentPhase))
    return null

  // 3. 获取下一个 phase
  const nextPhase = getNextPhase(currentPhase)
  if (!nextPhase)
    return null // 已经是最后一个阶段

  // 4. 检查 autoProgress
  const project = await getCanvasProjectById(task.projectId)
  if (!project)
    return null

  const modelPrefs = project.modelPreferencesJson
  if (!modelPrefs || !modelPrefs.autoProgress) {
    logger.info({ projectId: task.projectId, nextPhase }, 'autoProgress=false, skipping auto-advance')
    return null
  }

  // 5. 检查暂停阶段
  if (PAUSE_BEFORE.has(nextPhase)) {
    logger.info({ projectId: task.projectId, nextPhase }, 'pause-before phase, waiting for user confirmation')
    return null
  }

  // 6. 并发守卫 — 下一个 phase 没有 active run
  const activeRun = await findActiveRunForPhase(task.projectId, nextPhase)
  if (activeRun) {
    logger.info({ projectId: task.projectId, nextPhase, activeRunId: activeRun.id }, 'next phase already has active run, skipping')
    return null
  }

  // 7. 创建 pipeline_run + task + 链接
  try {
    const run = await createPipelineRun({
      projectId: task.projectId,
      phase: nextPhase,
      createdBy: task.accountId,
    })

    const taskType = phaseToTaskType(nextPhase)
    const newTask = await createTask({
      accountId: task.accountId,
      type: taskType,
      domain: 'canvas',
      priority: 5,
      projectId: task.projectId,
      targetType: 'pipeline_run',
      targetId: run.id,
    })

    await linkPipelineRunToTask(run.id, newTask.id)

    logger.info({ projectId: task.projectId, currentPhase, nextPhase, runId: run.id, taskId: newTask.id }, 'pipeline auto-advanced to next phase')
    return newTask.id
  }
  catch (err) {
    logger.error({ err, projectId: task.projectId, nextPhase }, 'failed to auto-advance pipeline')
    return null
  }
}
