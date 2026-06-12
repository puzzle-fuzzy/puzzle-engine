/**
 * Canvas 路由 — AI 视频制作流水线
 *
 * 这是系统中最大最复杂的路由文件，提供：
 *
 * 1. 项目 CRUD
 *    GET/POST/DELETE/PATCH /api/canvas/projects
 *
 * 2. Pipeline Run 查询
 *    GET /projects/:id/runs    — 列出某项目的所有运行记录
 *    GET /runs/:runId          — 查询单条运行记录
 *
 * 3. 流水线阶段执行（每个阶段走相同的并发守卫模式）：
 *    POST .../analyze          — LLM 分析故事文本
 *    POST .../characters       — 生成角色档案
 *    POST .../locations        — 生成场景档案
 *    POST .../character-refs   — AI 角色参考图
 *    POST .../location-refs    — AI 场景参考图
 *    POST .../storyboard       — LLM 分镜脚本
 *    POST .../continuity       — 规则校验连续性
 *    POST .../rebuild-prompts  — 重建视频提示词
 *    POST .../generate-videos  — 提交视频生成
 *
 * 4. 资源 PATCH/DELETE — 角色、场景、镜头的编辑和删除
 *
 * 5. 辅助操作
 *    POST .../layout           — 保存画布布局
 *    PATCH .../model-preferences — 更新模型偏好
 *    POST /shots/:id/retry     — 重试单个镜头
 *    POST .../retry-failed-shots — 批量重试失败镜头
 *
 * 关键模式：
 *   - 并发守卫：每个 phase 执行前通过 findActiveRunForPhase 检查是否有进行中的 run
 *   - fireAndForget：阶段执行立即返回 { accepted: true, runId }，结果通过 SSE 推送
 *   - 归属校验：所有操作先通过 getXxxForAccount 确认资源属于当前用户
 */
import type { CanvasPipelinePhase } from '@excuse/db'
import type { ServerConfig } from '../config'
import {
  createPipelineRun,
  findActiveRunForPhase,
  getCanvasCharacterForAccount,
  getCanvasLocationForAccount,
  getCanvasProjectByIdForAccount,
  getCanvasShotForAccount,
  getPipelineRunById,
  listPipelineRunsByProject,
  updateCanvasProject,
} from '@excuse/db'
import type { AcceptedResponse } from '@excuse/shared'
import { createLogger } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import * as svc from '../modules/canvas/service'
import { createRequireAuthPlugin } from '../plugins/auth'
import { dispatchToUser } from '../services/sse-manager'
import { conflict, notFound, validationError } from '../utils/errors'

const logger = createLogger('canvas-routes')

function acceptedResponse(runId?: string): AcceptedResponse {
  return runId ? { accepted: true, runId } : { accepted: true }
}

/**
 * fire-and-forget 包装器 — 管道阶段的后台执行与结果推送
 *
 * 流程：
 *   1. 等待 promise 完成 → SSE 推送 completed 事件
 *   2. promise 失败 → 更新项目状态为 failed + SSE 推送 failed 事件
 *
 * 不阻塞路由 handler 返回，实现"接受请求 → 后台执行 → SSE 通知"模式。
 */
function fireAndForgetWithRun(
  userId: string,
  projectId: string,
  phaseKey: string,
  runId: string,
  promise: Promise<unknown>,
) {
  promise
    .then(() => {
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'completed',
        runId,
      })
    })
    .catch((err) => {
      logger.error({ err, projectId, phaseKey }, `${phaseKey} failed`)
      updateCanvasProject(projectId, { status: 'failed' }).catch(dbErr =>
        logger.error({ err: dbErr, projectId }, 'Failed to update project status to failed'),
      )
      dispatchToUser(userId, 'pipeline_node_update', {
        projectId,
        nodeType: 'phase',
        nodeId: phaseKey,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
        runId,
      })
    })
}

export function createCanvasRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/canvas' })
    .use(createRequireAuthPlugin(config))

    // ===== 项目 CRUD =====
    .get('/projects', async ({ userId }) => {
      const projects = await svc.listProjects(userId)
      return { success: true, data: projects }
    })

    .post('/projects', async ({ body, userId }) => {
      const { title, storyText } = body
      const project = await svc.createProject(userId, { title, storyText })
      return { success: true, data: project }
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.String({ minLength: 10 }),
      }),
    })

    .get('/projects/:projectId', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const project = await svc.getProjectDetail(projectId)
      if (!project)
        return notFound(set, '项目不存在')
      return { success: true, data: project }
    })

    .delete('/projects/:projectId', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      await svc.softDeleteProject(projectId)
      return { success: true }
    })

    // 更新项目标题/故事文本
    .patch('/projects/:projectId', async ({ params: { projectId }, body, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const { title, storyText } = body
      if (title === undefined && storyText === undefined)
        return validationError(set, '至少提供一个字段')
      const project = await svc.updateProjectProperties(projectId, { title, storyText })
      return { success: true, data: project }
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.Optional(t.String({ minLength: 10 })),
      }),
    })

    // ===== Pipeline Run 查询 =====
    .get('/projects/:projectId/runs', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const runs = await listPipelineRunsByProject(projectId)
      return { success: true, data: runs }
    })

    .get('/runs/:runId', async ({ params: { runId }, userId, set }) => {
      const run = await getPipelineRunById(runId)
      if (!run)
        return notFound(set, '运行记录不存在')
      const owned = await getCanvasProjectByIdForAccount(run.projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      return { success: true, data: run }
    })

    // ===== 流水线步骤 =====
    // 每个 phase 先检查是否有 active run (并发守卫)，
    // 无则创建 run 记录 → 返回 { accepted: true, runId } → 后台执行
    // 有则返回 409 { accepted: false, error, existingRunId }
    .post('/projects/:projectId/analyze', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'analyze'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.analyzeProject(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/characters', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'characters'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateCharacters(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/locations', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'locations'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateLocations(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/character-refs', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'characterRefs'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateCharacterRefs(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/location-refs', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'locationRefs'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateLocationRefs(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/storyboard', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'storyboard'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateStoryboard(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/continuity', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'continuity'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.checkContinuity(projectId, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/rebuild-prompts', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'rebuild'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.rebuildShotPrompts(projectId, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/generate-videos', async ({ params: { projectId }, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const phase: CanvasPipelinePhase = 'videos'
      const activeRun = await findActiveRunForPhase(projectId, phase)
      if (activeRun)
        return conflict(set, `该阶段已有进行中的任务`)
      const run = await createPipelineRun({ projectId, phase, createdBy: userId })
      fireAndForgetWithRun(userId, projectId, phase, run.id, svc.generateVideos(projectId, config, run.id))
      return acceptedResponse(run.id)
    })

    .post('/projects/:projectId/layout', async ({ params: { projectId }, body, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      await svc.saveCanvasLayout(projectId, body)
      return { success: true }
    }, {
      body: t.Object({
        nodes: t.Array(t.Object({
          id: t.String(),
          type: t.Optional(t.String()),
          position: t.Object({
            x: t.Number(),
            y: t.Number(),
          }),
          width: t.Optional(t.Number()),
          height: t.Optional(t.Number()),
          data: t.Optional(t.Record(t.String(), t.Unknown())),
        })),
        edges: t.Array(t.Object({
          id: t.String(),
          source: t.String(),
          target: t.String(),
          type: t.Optional(t.String()),
          data: t.Optional(t.Record(t.String(), t.Unknown())),
        })),
        viewport: t.Optional(t.Object({
          x: t.Number(),
          y: t.Number(),
          zoom: t.Number(),
        })),
      }),
    })

    .patch('/projects/:projectId/model-preferences', async ({ params: { projectId }, body, userId, set }) => {
      const owned = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!owned)
        return notFound(set, '项目不存在或无权访问')
      const project = await svc.updateModelPreferences(projectId, body)
      return { success: true, data: project }
    }, {
      body: t.Object({
        textModel: t.Optional(t.String()),
        imageModel: t.Optional(t.String()),
        videoModel: t.Optional(t.String()),
      }),
    })

    // ===== 资源 PATCH =====
    .patch('/characters/:characterId', async ({ params: { characterId }, body, userId, set }) => {
      const character = await getCanvasCharacterForAccount(characterId, userId)
      if (!character)
        return notFound(set, '角色不存在或无权访问')
      const updated = await svc.updateCharacterData(characterId, body)
      return { success: true, data: updated }
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        role: t.Optional(t.String({ maxLength: 50 })),
        description: t.Optional(t.String()),
        identityPrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        locked: t.Optional(t.Boolean()),
      }),
    })

    .patch('/locations/:locationId', async ({ params: { locationId }, body, userId, set }) => {
      const location = await getCanvasLocationForAccount(locationId, userId)
      if (!location)
        return notFound(set, '场景不存在或无权访问')
      const updated = await svc.updateLocationData(locationId, body)
      return { success: true, data: updated }
    }, {
      body: t.Object({
        name: t.Optional(t.String({ maxLength: 200 })),
        type: t.Optional(t.String({ maxLength: 50 })),
        scenePrompt: t.Optional(t.String()),
        negativePrompt: t.Optional(t.String()),
        referenceImageUrl: t.Optional(t.String()),
        locked: t.Optional(t.Boolean()),
      }),
    })

    .patch('/shots/:shotId', async ({ params: { shotId }, body, userId, set }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        return notFound(set, '镜头不存在或无权访问')
      const updated = await svc.updateShotData(shotId, body)
      return { success: true, data: updated }
    }, {
      body: t.Object({
        duration: t.Optional(t.Number()),
        locationId: t.Optional(t.String()),
        characterIdsJson: t.Optional(t.Array(t.String())),
        narrative: t.Optional(t.String()),
        cameraJson: t.Optional(t.Object({
          shotSize: t.String(),
          angle: t.String(),
          movement: t.String(),
          lens: t.String(),
        })),
        environmentJson: t.Optional(t.Object({
          backgroundMotion: t.Optional(t.String()),
          lighting: t.Optional(t.String()),
          mood: t.Optional(t.String()),
          style: t.Optional(t.String()),
        })),
        videoPrompt: t.Optional(t.String()),
      }),
    })

    // ===== 资源 DELETE =====
    .delete('/characters/:characterId', async ({ params: { characterId }, userId, set }) => {
      const character = await getCanvasCharacterForAccount(characterId, userId)
      if (!character)
        return notFound(set, '角色不存在或无权访问')
      await svc.deleteCharacter(characterId)
      return { success: true }
    })

    .delete('/locations/:locationId', async ({ params: { locationId }, userId, set }) => {
      const location = await getCanvasLocationForAccount(locationId, userId)
      if (!location)
        return notFound(set, '场景不存在或无权访问')
      await svc.deleteLocation(locationId)
      return { success: true }
    })

    .delete('/shots/:shotId', async ({ params: { shotId }, userId, set }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        return notFound(set, '镜头不存在或无权访问')
      await svc.deleteShot(shotId)
      return { success: true }
    })

    // 重试单个失败的镜头视频 — retry 不创建 pipeline run 记录
    .post('/shots/:shotId/retry', async ({ params: { shotId }, userId, set }) => {
      const shot = await getCanvasShotForAccount(shotId, userId)
      if (!shot)
        return notFound(set, '镜头不存在或无权访问')
      svc.retryShotVideo(shotId, config).catch((err) => {
        logger.error({ err, shotId }, 'retry failed')
        updateCanvasProject(shot.projectId, { status: 'failed' }).catch(dbErr =>
          logger.error({ err: dbErr, projectId: shot.projectId }, 'Failed to update project status to failed'),
        )
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId: shot.projectId,
          nodeType: 'shot',
          nodeId: shotId,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      })
      return acceptedResponse()
    })

    // 批量重试项目中所有失败的镜头
    .post('/projects/:projectId/retry-failed-shots', async ({ params: { projectId }, userId, set }) => {
      const project = await getCanvasProjectByIdForAccount(projectId, userId)
      if (!project)
        return notFound(set, '项目不存在或无权访问')
      svc.retryFailedShots(projectId, userId, config).catch((err) => {
        logger.error({ err, projectId }, 'batch retry failed shots error')
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId,
          nodeType: 'phase',
          nodeId: 'retry-failed-shots',
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      })
      return acceptedResponse()
    })
}
