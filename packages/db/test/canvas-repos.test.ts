import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import {
  createCanvasCharacter,
  deleteCanvasCharactersByProject,
  getCanvasCharacterById,
  listCanvasCharactersByProject,
  updateCanvasCharacter,
} from '../src/repositories/canvas-characters.repo'
import {
  createContinuityReport,
  getLatestContinuityReport,
} from '../src/repositories/canvas-continuity.repo'
import {
  createCanvasLocation,
  getCanvasLocationById,
  listCanvasLocationsByProject,
  updateCanvasLocation,
} from '../src/repositories/canvas-locations.repo'
import {
  createCanvasProject,
  getCanvasProjectById,
  getCanvasProjectDetail,
  listCanvasProjectsByAccount,
  softDeleteCanvasProject,
  updateCanvasProject,
} from '../src/repositories/canvas-projects.repo'
import {
  batchCreateCanvasShots,
  createCanvasShot,
  deleteCanvasShotsByProject,
  getCanvasShotById,
  listCanvasShotsByProject,
  resetCanvasShotToDraft,
  updateCanvasShot,
} from '../src/repositories/canvas-shots.repo'
import {
  beginTestTransaction,
  initTestDb,
  rollbackTestTransaction,
  teardownTestDb,
} from './helpers/test-db'

describe('canvas repositories', () => {
  let accountId: string

  beforeAll(async () => {
    await initTestDb()
  })

  afterAll(async () => {
    await teardownTestDb()
  })

  beforeEach(async () => {
    const ctx = await beginTestTransaction()
    accountId = ctx.accountId
  })

  afterEach(async () => {
    await rollbackTestTransaction()
  })

  // ═══════════════════════════════════════════════════════
  //  Canvas Projects
  // ═══════════════════════════════════════════════════════

  describe('canvas-projects.repo', () => {
    it('should create and get a project', async () => {
      const project = await createCanvasProject({
        accountId,
        storyText: '一段测试故事文本',
      })

      expect(project.id).toBeDefined()
      expect(project.accountId).toBe(accountId)
      expect(project.storyText).toBe('一段测试故事文本')
      expect(project.status).toBe('draft')
      expect(project.isDeleted).toBe(false)

      const found = await getCanvasProjectById(project.id)
      expect(found).not.toBeNull()
      expect(found!.id).toBe(project.id)
    })

    it('should create project with title and analysis', async () => {
      const project = await createCanvasProject({
        accountId,
        title: '测试项目',
        storyText: '故事',
        analysisJson: { summary: '摘要', mainConflict: '冲突', timeline: [], characterNames: [], sceneNames: [] },
      })

      expect(project.title).toBe('测试项目')
      expect(project.analysisJson).toEqual({ summary: '摘要', mainConflict: '冲突', timeline: [], characterNames: [], sceneNames: [] })
    })

    it('should list projects by account', async () => {
      await createCanvasProject({ accountId, storyText: '故事1' })
      await createCanvasProject({ accountId, storyText: '故事2' })

      const list = await listCanvasProjectsByAccount(accountId)
      expect(list).toHaveLength(2)
    })

    it('should update project fields', async () => {
      const project = await createCanvasProject({ accountId, storyText: '原始故事' })

      const updated = await updateCanvasProject(project.id, {
        title: '更新标题',
        status: 'analyzed',
        analysisJson: { mainConflict: '冲突', summary: '', timeline: [], characterNames: [], sceneNames: [] },
      })

      expect(updated).not.toBeNull()
      expect(updated!.title).toBe('更新标题')
      expect(updated!.status).toBe('analyzed')
    })

    it('should soft-delete project (isDeleted=true)', async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      await softDeleteCanvasProject(project.id)

      // getCanvasProjectById 过滤 isDeleted=true，应返回 null
      const found = await getCanvasProjectById(project.id)
      expect(found).toBeNull()
    })

    it('should return null for nonexistent project', async () => {
      const found = await getCanvasProjectById('00000000-0000-0000-0000-000000000000')
      expect(found).toBeNull()
    })

    it('should return project detail with children', async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      await createCanvasCharacter({ projectId: project.id, name: '角色A' })
      await createCanvasLocation({ projectId: project.id, name: '场景A' })

      const detail = await getCanvasProjectDetail(project.id)
      expect(detail).not.toBeNull()
      expect(detail!.characters).toHaveLength(1)
      expect(detail!.locations).toHaveLength(1)
    })
  })

  // ═══════════════════════════════════════════════════════
  //  Canvas Characters
  // ═══════════════════════════════════════════════════════

  describe('canvas-characters.repo', () => {
    let projectId: string

    beforeEach(async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      projectId = project.id
    })

    it('should create and get a character', async () => {
      const character = await createCanvasCharacter({
        projectId,
        name: '小明',
        role: '主角',
        identityPrompt: '一个穿着蓝衣服的少年',
      })

      expect(character.id).toBeDefined()
      expect(character.projectId).toBe(projectId)
      expect(character.name).toBe('小明')
      expect(character.role).toBe('主角')
      expect(character.identityPrompt).toBe('一个穿着蓝衣服的少年')
      expect(character.locked).toBe(false)

      const found = await getCanvasCharacterById(character.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('小明')
    })

    it('should list characters by project', async () => {
      await createCanvasCharacter({ projectId, name: '角色1' })
      await createCanvasCharacter({ projectId, name: '角色2' })

      const list = await listCanvasCharactersByProject(projectId)
      expect(list).toHaveLength(2)
    })

    it('should update character fields', async () => {
      const character = await createCanvasCharacter({ projectId, name: '原名' })

      const updated = await updateCanvasCharacter(character.id, {
        name: '新名',
        locked: true,
      })

      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('新名')
      expect(updated!.locked).toBe(true)
    })

    it('should delete characters by project', async () => {
      await createCanvasCharacter({ projectId, name: '角色A' })
      await deleteCanvasCharactersByProject(projectId)

      const list = await listCanvasCharactersByProject(projectId)
      expect(list).toHaveLength(0)
    })

    it('should delete characters excluding locked', async () => {
      const c1 = await createCanvasCharacter({ projectId, name: '未锁定' })
      await updateCanvasCharacter(c1.id, { locked: false })
      const c2 = await createCanvasCharacter({ projectId, name: '已锁定' })
      await updateCanvasCharacter(c2.id, { locked: true })

      await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })

      const list = await listCanvasCharactersByProject(projectId)
      expect(list).toHaveLength(1)
      expect(list[0]!.name).toBe('已锁定')
    })
  })

  // ═══════════════════════════════════════════════════════
  //  Canvas Locations
  // ═══════════════════════════════════════════════════════

  describe('canvas-locations.repo', () => {
    let projectId: string

    beforeEach(async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      projectId = project.id
    })

    it('should create and get a location', async () => {
      const location = await createCanvasLocation({
        projectId,
        name: '古城',
        type: 'exterior',
        scenePrompt: '一座古老的城池',
      })

      expect(location.id).toBeDefined()
      expect(location.projectId).toBe(projectId)
      expect(location.name).toBe('古城')
      expect(location.type).toBe('exterior')
      expect(location.scenePrompt).toBe('一座古老的城池')
      expect(location.locked).toBe(false)

      const found = await getCanvasLocationById(location.id)
      expect(found).not.toBeNull()
      expect(found!.name).toBe('古城')
    })

    it('should default type to mixed', async () => {
      const location = await createCanvasLocation({ projectId, name: '混合场景' })
      expect(location.type).toBe('mixed')
    })

    it('should list locations by project', async () => {
      await createCanvasLocation({ projectId, name: '场景1' })
      await createCanvasLocation({ projectId, name: '场景2' })

      const list = await listCanvasLocationsByProject(projectId)
      expect(list).toHaveLength(2)
    })

    it('should update location fields', async () => {
      const location = await createCanvasLocation({ projectId, name: '原名' })

      const updated = await updateCanvasLocation(location.id, {
        name: '新名',
        locked: true,
        referenceImageUrl: 'https://ref.img',
      })

      expect(updated).not.toBeNull()
      expect(updated!.name).toBe('新名')
      expect(updated!.locked).toBe(true)
      expect(updated!.referenceImageUrl).toBe('https://ref.img')
    })
  })

  // ═══════════════════════════════════════════════════════
  //  Canvas Shots
  // ═══════════════════════════════════════════════════════

  describe('canvas-shots.repo', () => {
    let projectId: string

    beforeEach(async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      projectId = project.id
    })

    it('should create and get a shot', async () => {
      const shot = await createCanvasShot({
        projectId,
        shotIndex: 1,
        narrative: '角色走入场景',
        cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' },
        continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' },
      })

      expect(shot.id).toBeDefined()
      expect(shot.projectId).toBe(projectId)
      expect(shot.shotIndex).toBe(1)
      expect(shot.narrative).toBe('角色走入场景')
      expect(shot.duration).toBe(5) // default
      expect(shot.status).toBe('draft')
      expect(shot.characterIdsJson).toEqual([]) // default

      const found = await getCanvasShotById(shot.id)
      expect(found).not.toBeNull()
      expect(found!.shotIndex).toBe(1)
    })

    it('should batch create shots', async () => {
      const shots = await batchCreateCanvasShots([
        { projectId, shotIndex: 1, narrative: '镜头1', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } },
        { projectId, shotIndex: 2, narrative: '镜头2', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } },
      ])

      expect(shots).toHaveLength(2)
      expect(shots[0]!.shotIndex).toBe(1)
      expect(shots[1]!.shotIndex).toBe(2)
    })

    it('should list shots by project ordered by shotIndex', async () => {
      await createCanvasShot({ projectId, shotIndex: 3, narrative: '镜头3', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })
      await createCanvasShot({ projectId, shotIndex: 1, narrative: '镜头1', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })
      await createCanvasShot({ projectId, shotIndex: 2, narrative: '镜头2', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })

      const list = await listCanvasShotsByProject(projectId)
      expect(list).toHaveLength(3)
      expect(list[0]!.shotIndex).toBe(1)
      expect(list[1]!.shotIndex).toBe(2)
      expect(list[2]!.shotIndex).toBe(3)
    })

    it('should update shot fields', async () => {
      const shot = await createCanvasShot({ projectId, shotIndex: 1, narrative: '原始', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })

      const updated = await updateCanvasShot(shot.id, {
        narrative: '更新叙述',
        status: 'ready',
        videoPrompt: '生成提示词',
      })

      expect(updated).not.toBeNull()
      expect(updated!.narrative).toBe('更新叙述')
      expect(updated!.status).toBe('ready')
    })

    it('should reset shot to draft', async () => {
      const shot = await createCanvasShot({ projectId, shotIndex: 1, narrative: '镜头', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })
      await updateCanvasShot(shot.id, { status: 'generating', videoTaskId: 'task-123' })

      await resetCanvasShotToDraft(shot.id)

      const found = await getCanvasShotById(shot.id)
      expect(found!.status).toBe('draft')
      expect(found!.videoTaskId).toBeNull()
      expect(found!.videoUrl).toBeNull()
      expect(found!.errorMessage).toBeNull()
    })

    it('should delete shots by project', async () => {
      await createCanvasShot({ projectId, shotIndex: 1, narrative: '镜头', cameraJson: { shotSize: '中景', angle: '正面', movement: '固定', lens: '35mm' }, continuityJson: { screenDirection: '左→右', characterFacing: {}, actionStart: '', actionEnd: '', emotionStart: '', emotionEnd: '' } })
      await deleteCanvasShotsByProject(projectId)

      const list = await listCanvasShotsByProject(projectId)
      expect(list).toHaveLength(0)
    })
  })

  // ═══════════════════════════════════════════════════════
  //  Canvas Continuity Reports
  // ═══════════════════════════════════════════════════════

  describe('canvas-continuity.repo', () => {
    let projectId: string

    beforeEach(async () => {
      const project = await createCanvasProject({ accountId, storyText: '故事' })
      projectId = project.id
    })

    it('should create and retrieve latest report', async () => {
      const report = await createContinuityReport({
        projectId,
        issuesJson: [{ code: 'MISSING_SCENE', severity: 'error', message: '缺少场景' }],
      })

      expect(report.id).toBeDefined()
      expect(report.projectId).toBe(projectId)
      expect(report.issuesJson).toHaveLength(1)

      const latest = await getLatestContinuityReport(projectId)
      expect(latest).not.toBeNull()
      expect(latest!.id).toBe(report.id)
    })

    it('should return one of the created reports', async () => {
      await createContinuityReport({ projectId, issuesJson: [{ code: 'FIRST', severity: 'warning', message: '报告1' }] })
      await createContinuityReport({ projectId, issuesJson: [{ code: 'SECOND', severity: 'error', message: '报告2' }] })

      const latest = await getLatestContinuityReport(projectId)
      expect(latest).not.toBeNull()
      expect(latest!.projectId).toBe(projectId)
      expect(latest!.issuesJson).toHaveLength(1)
    })

    it('should return null when no reports exist', async () => {
      const latest = await getLatestContinuityReport(projectId)
      expect(latest).toBeNull()
    })
  })
})
