import type { ServerConfig } from '../config'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import * as svc from '../modules/canvas/service'

export function createCanvasRoutes(config: ServerConfig) {
  return new Elysia({ prefix: '/api/canvas' })
    .use(createAuthPlugin(config))

    // ===== 项目 CRUD =====
    .get('/projects', async ({ userId }) => {
      if (!userId) return { success: false, error: '请先登录' }
      const projects = await svc.listProjects(userId)
      return { success: true, data: projects }
    })

    .post('/projects', async ({ body, userId }) => {
      if (!userId) return { success: false, error: '请先登录' }
      const { title, storyText } = body as { title?: string; storyText: string }
      const project = await svc.createProject(userId, { title, storyText })
      return { success: true, data: project }
    }, {
      body: t.Object({
        title: t.Optional(t.String({ maxLength: 500 })),
        storyText: t.String({ minLength: 10 }),
      }),
    })

    .get('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      if (!userId) return { success: false, error: '请先登录' }
      const project = await svc.getProjectDetail(projectId)
      if (!project) return { success: false, error: '项目不存在' }
      return { success: true, data: project }
    })

    .delete('/projects/:projectId', async ({ params: { projectId }, userId }) => {
      if (!userId) return { success: false, error: '请先登录' }
      await svc.softDeleteProject(projectId)
      return { success: true }
    })

    // ===== 流水线步骤 =====
    .post('/projects/:projectId/analyze', async ({ params: { projectId } }) => {
      const project = await svc.analyzeProject(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/characters', async ({ params: { projectId } }) => {
      const project = await svc.generateCharacters(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/locations', async ({ params: { projectId } }) => {
      const project = await svc.generateLocations(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/character-refs', async ({ params: { projectId } }) => {
      const project = await svc.generateCharacterRefs(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/location-refs', async ({ params: { projectId } }) => {
      const project = await svc.generateLocationRefs(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/storyboard', async ({ params: { projectId } }) => {
      const project = await svc.generateStoryboard(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/continuity', async ({ params: { projectId } }) => {
      const project = await svc.checkContinuity(projectId)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/rebuild-prompts', async ({ params: { projectId } }) => {
      const project = await svc.rebuildShotPrompts(projectId)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/generate-videos', async ({ params: { projectId } }) => {
      const project = await svc.generateVideos(projectId, config)
      return { success: true, data: project }
    })

    .post('/projects/:projectId/layout', async ({ params: { projectId }, body }) => {
      const layout = body as Record<string, unknown>
      await svc.saveCanvasLayout(projectId, layout)
      return { success: true }
    })

    // ===== 资源 PATCH =====
    .patch('/characters/:characterId', async ({ params: { characterId }, body }) => {
      const patch = body as { identityPrompt?: string; negativePrompt?: string; locked?: boolean }
      const updated = await svc.updateCharacterData(characterId, patch)
      return { success: true, data: updated }
    })

    .patch('/locations/:locationId', async ({ params: { locationId }, body }) => {
      const patch = body as { scenePrompt?: string; negativePrompt?: string; locked?: boolean }
      const updated = await svc.updateLocationData(locationId, patch)
      return { success: true, data: updated }
    })

    .patch('/shots/:shotId', async ({ params: { shotId }, body }) => {
      const patch = body as { narrative?: string; videoPrompt?: string }
      const updated = await svc.updateShotData(shotId, patch)
      return { success: true, data: updated }
    })
}
