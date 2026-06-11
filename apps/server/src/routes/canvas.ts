import type { ServerConfig } from '../config'
import type { ShotCamera, ShotEnvironment } from '@excuse/db'
import { updateCanvasProject } from '@excuse/db'
import { createLogger } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import * as svc from '../modules/canvas/service'
import { createAuthPlugin } from '../plugins/auth'
import { dispatchToUser } from '../services/sse-manager'

const logger = createLogger('canvas-routes')

function fireAndForget(
  userId: string | null | undefined,
  projectId: string,
  phaseKey: string,
  promise: Promise<unknown>,
) {
  promise
    .then(() => {
      if (userId) {
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId,
          nodeType: 'phase',
          nodeId: phaseKey,
          status: 'completed',
        })
      }
    })
    .catch((err) => {
      logger.error({ err, projectId, phaseKey }, `${phaseKey} failed`)
      // Update DB status to 'failed' so the project doesn't stay stuck
      updateCanvasProject(projectId, { status: 'failed' }).catch(dbErr =>
        logger.error({ err: dbErr, projectId }, 'Failed to update project status to failed'),
      )
      if (userId) {
        dispatchToUser(userId, 'pipeline_node_update', {
          projectId,
          nodeType: 'phase',
          nodeId: phaseKey,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        })
      }
    })
}

export function createCanvasRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/canvas' })
    .use(createAuthPlugin(config))

    // ===== 项目 CRUD =====
    .get('/projects', async ({ userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      const projects = await svc.listProjects(userId)
      return { success: true, data: projects }
    })

    .post('/projects', async ({ body, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      const { title, storyText } = body as { title?: string, storyText: string }
      const project = await svc.createProject(userId, { title, storyText })
      return { success: true, data: project }
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.String({ minLength: 10 }),
      }),
    })

    .get('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      const project = await svc.getProjectDetail(projectId)
      if (!project)
        return { success: false, error: '项目不存在' }
      return { success: true, data: project }
    })

    .delete('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      await svc.softDeleteProject(projectId)
      return { success: true }
    })

    // 更新项目标题/故事文本
    .patch('/projects/:projectId', async ({ params: { projectId }, body, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      const { title, storyText } = body as { title?: string, storyText?: string }
      if (title === undefined && storyText === undefined)
        return { success: false, error: '至少提供一个字段' }
      const project = await svc.updateProjectProperties(projectId, { title, storyText })
      return { success: true, data: project }
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.Optional(t.String({ minLength: 10 })),
      }),
    })

    // ===== 流水线步骤 =====
    // 所有流水线接口采用 fire-and-forget 模式：
    // 立即返回，后台执行，通过 SSE 推送进度和阶段完成事件
    .post('/projects/:projectId/analyze', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'analyze', svc.analyzeProject(projectId, config))
      return { success: true, message: '开始分析' }
    })

    .post('/projects/:projectId/characters', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'characters', svc.generateCharacters(projectId, config))
      return { success: true, message: '开始生成角色' }
    })

    .post('/projects/:projectId/locations', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'locations', svc.generateLocations(projectId, config))
      return { success: true, message: '开始生成场景' }
    })

    .post('/projects/:projectId/character-refs', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'characterRefs', svc.generateCharacterRefs(projectId, config))
      return { success: true, message: '开始生成角色参考图' }
    })

    .post('/projects/:projectId/location-refs', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'locationRefs', svc.generateLocationRefs(projectId, config))
      return { success: true, message: '开始生成场景参考图' }
    })

    .post('/projects/:projectId/storyboard', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'storyboard', svc.generateStoryboard(projectId, config))
      return { success: true, message: '开始生成分镜' }
    })

    .post('/projects/:projectId/continuity', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'continuity', svc.checkContinuity(projectId))
      return { success: true, message: '开始连续性检查' }
    })

    .post('/projects/:projectId/rebuild-prompts', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'rebuild', svc.rebuildShotPrompts(projectId))
      return { success: true, message: '开始重建 Prompt' }
    })

    .post('/projects/:projectId/generate-videos', async ({ params: { projectId }, userId }) => {
      fireAndForget(userId, projectId, 'videos', svc.generateVideos(projectId, config))
      return { success: true, message: '开始生成视频' }
    })

    .post('/projects/:projectId/layout', async ({ params: { projectId }, body }) => {
      const layout = body as Record<string, unknown>
      await svc.saveCanvasLayout(projectId, layout)
      return { success: true }
    })

    .patch('/projects/:projectId/model-preferences', async ({ params: { projectId }, body }) => {
      const prefs = body as { textModel?: string, imageModel?: string, videoModel?: string }
      const project = await svc.updateModelPreferences(projectId, prefs)
      return { success: true, data: project }
    })

    // ===== 资源 PATCH =====
    .patch('/characters/:characterId', async ({ params: { characterId }, body }) => {
      const patch = body as {
        name?: string
        role?: string
        description?: string
        identityPrompt?: string
        negativePrompt?: string
        referenceImageUrl?: string
        locked?: boolean
      }
      const updated = await svc.updateCharacterData(characterId, patch)
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

    .patch('/locations/:locationId', async ({ params: { locationId }, body }) => {
      const patch = body as {
        name?: string
        type?: string
        scenePrompt?: string
        negativePrompt?: string
        referenceImageUrl?: string
        locked?: boolean
      }
      const updated = await svc.updateLocationData(locationId, patch)
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

    .patch('/shots/:shotId', async ({ params: { shotId }, body }) => {
      const patch = body as {
        duration?: number
        locationId?: string
        characterIdsJson?: string[]
        narrative?: string
        cameraJson?: ShotCamera
        environmentJson?: ShotEnvironment
        videoPrompt?: string
      }
      const updated = await svc.updateShotData(shotId, patch)
      return { success: true, data: updated }
    }, {
      body: t.Object({
        duration: t.Optional(t.Number()),
        locationId: t.Optional(t.String()),
        characterIdsJson: t.Optional(t.Array(t.String())),
        narrative: t.Optional(t.String()),
        cameraJson: t.Optional(t.Record(t.String(), t.Any())),
        environmentJson: t.Optional(t.Record(t.String(), t.Any())),
        videoPrompt: t.Optional(t.String()),
      }),
    })

    // ===== 资源 DELETE =====
    .delete('/characters/:characterId', async ({ params: { characterId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      await svc.deleteCharacter(characterId)
      return { success: true }
    })

    .delete('/locations/:locationId', async ({ params: { locationId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      await svc.deleteLocation(locationId)
      return { success: true }
    })

    .delete('/shots/:shotId', async ({ params: { shotId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      await svc.deleteShot(shotId)
      return { success: true }
    })

    // 重试单个失败的镜头视频
    .post('/shots/:shotId/retry', async ({ params: { shotId }, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }
      fireAndForget(userId, shotId, 'retry', svc.retryShotVideo(shotId, config))
      return { success: true, message: '开始重试镜头' }
    })
}
