import type { CanvasProjectDetail } from '../src/normalize'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { runContinuityPhase } from '../src/phases/continuity'
import { buildShotVideoPromptEntity } from '../src/phases/rebuild'

// ─── Mock @excuse/db（continuity 只用到 createContinuityReport） ─────

const createContinuityReport = mock<(values: { projectId: string, issuesJson: unknown }) => Promise<void>>(
  () => Promise.resolve(),
)

mock.module('@excuse/db', () => ({
  createContinuityReport,
}))

beforeEach(() => {
  createContinuityReport.mockClear()
})

/**
 * 连续性校验是纯计算 —— core 内部 validateShotContinuity + createContinuityReport，
 * 不触碰 LLM client、不写项目状态。这里用一个最小的合法 detail 喂入。
 */
const baseShot = {
  id: 'shot-1',
  shotIndex: 0,
  locationId: 'loc-1' as string | null,
  characterIdsJson: ['char-1'],
  narrative: '开场',
  duration: 5,
  cameraJson: { shotSize: 'wide', angle: 'front', movement: 'static', lens: '35mm' },
  continuityJson: {
    actionStart: '站立',
    actionEnd: '走入画面',
    emotionStart: '平静',
    emotionEnd: '紧张',
    characterFacing: { 'char-1': 'left' },
  },
  timelineJson: null,
  environmentJson: null,
}

const baseCharacter = {
  id: 'char-1',
  name: '李雷',
  identityPrompt: '少年',
  negativePrompt: '畸形',
}

const baseLocation = {
  id: 'loc-1',
  name: '古镇',
  scenePrompt: '青石板',
  negativePrompt: '现代',
  profileJson: { cameraRules: { axisDirection: 'left', allowedAngles: ['front'], forbiddenAngles: ['back'] } },
}

function makeDetail(shots = [baseShot]): CanvasProjectDetail {
  return {
    project: { id: 'p1', accountId: 'a1' },
    shots,
    characters: [baseCharacter],
    locations: [baseLocation],
  } as unknown as CanvasProjectDetail
}

describe('runContinuityPhase', () => {
  it('runs the pure validator and persists a continuity report, without an LLM client', async () => {
    const { issues } = await runContinuityPhase({
      projectId: 'p1',
      detail: makeDetail(),
    })

    // 验证器对单镜头正常输入应返回 issues 数组（可能为空）
    expect(Array.isArray(issues)).toBe(true)
    expect(createContinuityReport).toHaveBeenCalledTimes(1)
    const [values] = createContinuityReport.mock.calls[0]!
    expect(values.projectId).toBe('p1')
    expect(values.issuesJson).toBe(issues)
  })

  it('flags a forbidden camera angle as an issue', async () => {
    const forbiddenShot = {
      ...baseShot,
      cameraJson: { ...baseShot.cameraJson, angle: 'back' },
    }
    const { issues } = await runContinuityPhase({
      projectId: 'p1',
      detail: makeDetail([forbiddenShot]),
    })

    // loc-1 禁止 back 角度，应被检出
    expect(issues.length).toBeGreaterThan(0)
    expect(createContinuityReport).toHaveBeenCalledTimes(1)
  })
})

describe('buildShotVideoPromptEntity', () => {
  it('returns a non-empty videoPrompt and negativePrompt from the normalized shot', () => {
    const { videoPrompt, negativePrompt } = buildShotVideoPromptEntity({
      shot: baseShot as unknown as CanvasProjectDetail['shots'][number],
      characters: [baseCharacter] as unknown as CanvasProjectDetail['characters'][number][],
      location: baseLocation as unknown as CanvasProjectDetail['locations'][number],
    })

    expect(typeof videoPrompt).toBe('string')
    expect(videoPrompt.length).toBeGreaterThan(0)
    // 角色名与场景 scenePrompt 应出现在合成 prompt 里
    expect(videoPrompt).toContain('李雷')
    expect(videoPrompt).toContain('青石板')
    expect(typeof negativePrompt).toBe('string')
  })

  it('is pure (no DB or client call) and deterministic for identical input', () => {
    const input = {
      shot: baseShot as unknown as CanvasProjectDetail['shots'][number],
      characters: [baseCharacter] as unknown as CanvasProjectDetail['characters'][number][],
      location: baseLocation as unknown as CanvasProjectDetail['locations'][number],
    }
    const a = buildShotVideoPromptEntity(input)
    const b = buildShotVideoPromptEntity(input)
    expect(a).toEqual(b)
  })
})
