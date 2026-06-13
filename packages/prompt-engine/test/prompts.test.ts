import { describe, expect, it } from 'bun:test'
import { buildAnalysisPrompt, buildCharacterPrompt, buildLocationPrompt, buildStoryboardPrompt } from '../src'

const storyText = '在一个遥远的王国里，住着一位勇敢的少年。他踏上了一段冒险旅程。'
const analysis = {
  summary: '一个关于勇敢少年的冒险故事',
  mainConflict: '善与恶的对抗',
  timeline: ['少年出发', '遇到挑战', '最终胜利'],
}

describe('buildAnalysisPrompt', () => {
  it('should return system and prompt fields', () => {
    const result = buildAnalysisPrompt(storyText)
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('should include JSON format instructions in system', () => {
    const { system } = buildAnalysisPrompt(storyText)
    expect(system).toContain('JSON')
    expect(system).toContain('summary')
    expect(system).toContain('characterNames')
    expect(system).toContain('sceneNames')
  })

  it('should include story text in prompt', () => {
    const { prompt } = buildAnalysisPrompt(storyText)
    expect(prompt).toContain(storyText)
  })
})

describe('buildCharacterPrompt', () => {
  it('should return system and prompt fields', () => {
    const result = buildCharacterPrompt(storyText, analysis, '小明')
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('should include character name in prompt', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain('小明')
  })

  it('should include story text in prompt', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain(storyText.slice(0, 3000))
  })

  it('should include analysis summary in prompt', () => {
    const { prompt } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(prompt).toContain(analysis.summary)
    expect(prompt).toContain(analysis.mainConflict)
  })

  it('should include identityPrompt rules in system', () => {
    const { system } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(system).toContain('identityPrompt')
    expect(system).toContain('negativePrompt')
  })

  it('should include JSON output format in system', () => {
    const { system } = buildCharacterPrompt(storyText, analysis, '小明')
    expect(system).toContain('face')
    expect(system).toContain('hair')
    expect(system).toContain('costume')
  })
})

describe('buildLocationPrompt', () => {
  it('should return system and prompt fields', () => {
    const result = buildLocationPrompt(storyText, analysis, '王城')
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('should include scene name in prompt', () => {
    const { prompt } = buildLocationPrompt(storyText, analysis, '王城')
    expect(prompt).toContain('王城')
  })

  it('should include analysis summary in prompt', () => {
    const { prompt } = buildLocationPrompt(storyText, analysis, '王城')
    expect(prompt).toContain(analysis.summary)
  })

  it('should include cameraRules in system format', () => {
    const { system } = buildLocationPrompt(storyText, analysis, '王城')
    expect(system).toContain('cameraRules')
    expect(system).toContain('axisDirection')
    expect(system).toContain('forbiddenAngles')
  })

  it('should include scenePrompt in system format', () => {
    const { system } = buildLocationPrompt(storyText, analysis, '王城')
    expect(system).toContain('scenePrompt')
    expect(system).toContain('visualRules')
  })
})

describe('buildStoryboardPrompt', () => {
  const characters = [
    { id: 'char-uuid-1', name: '小明', identityPrompt: 'A brave young boy' },
    { id: 'char-uuid-2', name: '小红', identityPrompt: 'A clever girl' },
  ]
  const locations = [
    { id: 'loc-uuid-1', name: '王城', scenePrompt: 'A grand castle' },
    { id: 'loc-uuid-2', name: '森林', scenePrompt: 'A dark mysterious forest' },
  ]

  it('should return system and prompt fields', () => {
    const result = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(result).toHaveProperty('system')
    expect(result).toHaveProperty('prompt')
  })

  it('should include character list with IDs in prompt', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain('char-uuid-1')
    expect(prompt).toContain('小明')
    expect(prompt).toContain('char-uuid-2')
    expect(prompt).toContain('小红')
  })

  it('should include location list with IDs in prompt', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain('loc-uuid-1')
    expect(prompt).toContain('王城')
    expect(prompt).toContain('loc-uuid-2')
    expect(prompt).toContain('森林')
  })

  it('should include story text in prompt', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain(storyText.slice(0, 4000))
  })

  it('should include timeline requirements in system', () => {
    const { system } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(system).toContain('timeline')
    expect(system).toContain('duration')
    expect(system).toContain('continuity')
    expect(system).toContain('environment')
  })

  it('should include UUID requirement in system', () => {
    const { system } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(system).toContain('UUID')
  })

  it('should handle empty characters and locations', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, [], [])
    expect(prompt).toContain(storyText)
  })

  it('should include analysis in prompt', () => {
    const { prompt } = buildStoryboardPrompt(storyText, analysis, characters, locations)
    expect(prompt).toContain(analysis.summary)
    expect(prompt).toContain(analysis.mainConflict)
    expect(prompt).toContain(analysis.timeline.join(' → '))
  })
})
