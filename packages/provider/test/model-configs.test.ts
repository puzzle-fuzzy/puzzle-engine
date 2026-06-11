import { describe, expect, it } from 'bun:test'
import { getModelById, getModelsByCategory, MODELS } from '../src/model-configs'

describe('getModelById', () => {
  it('返回已存在的模型配置', () => {
    const model = getModelById('qwen-max')
    expect(model).toBeDefined()
    expect(model!.id).toBe('qwen-max')
    expect(model!.category).toBe('text')
    expect(model!.requestType).toBe('chat')
  })

  it('返回 undefined 对于不存在的模型', () => {
    expect(getModelById('nonexistent')).toBeUndefined()
  })

  it('所有模型都包含必要字段', () => {
    for (const [id, model] of Object.entries(MODELS)) {
      expect(model.id).toBe(id)
      expect(model.name).toBeTruthy()
      expect(['text', 'image', 'video']).toContain(model.category)
      expect(['generation', 'understanding', 'editing']).toContain(model.type)
      expect(model.endpoint).toBeTruthy()
      expect(model.pricing.inputPrice).toBeGreaterThan(0)
      expect(model.parameters).toBeInstanceOf(Array)
    }
  })
})

describe('getModelsByCategory', () => {
  it('返回文本模型列表', () => {
    const textModels = getModelsByCategory('text')
    expect(textModels.length).toBeGreaterThan(0)
    expect(textModels.every(m => m.category === 'text')).toBe(true)
  })

  it('返回图片模型列表', () => {
    const imageModels = getModelsByCategory('image')
    expect(imageModels.length).toBeGreaterThan(0)
    expect(imageModels.every(m => m.category === 'image')).toBe(true)
  })

  it('返回视频模型列表', () => {
    const videoModels = getModelsByCategory('video')
    expect(videoModels.length).toBeGreaterThan(0)
    expect(videoModels.every(m => m.category === 'video')).toBe(true)
  })

  it('不存在类别返回空数组', () => {
    expect(getModelsByCategory('audio')).toHaveLength(0)
  })
})

describe('模型配置完整性', () => {
  it('所有模型都有 inputMapping 和 requestType', () => {
    for (const model of Object.values(MODELS)) {
      expect(model.inputMapping, `${model.id} 缺少 inputMapping`).toBeDefined()
      expect(model.requestType, `${model.id} 缺少 requestType`).toBeDefined()
    }
  })

  it('文本模型使用 chat requestType', () => {
    const textModels = getModelsByCategory('text')
    for (const model of textModels) {
      expect(model.requestType).toBe('chat')
    }
  })

  it('图片模型使用 image requestType', () => {
    const imageModels = getModelsByCategory('image')
    for (const model of imageModels) {
      expect(model.requestType).toBe('image')
    }
  })

  it('视频模型使用 video-t2v 或 video-media requestType', () => {
    const videoModels = getModelsByCategory('video')
    for (const model of videoModels) {
      expect(['video-t2v', 'video-media']).toContain(model.requestType)
    }
  })

  it('异步模型标记 async=true，同步模型标记 async=false', () => {
    for (const model of Object.values(MODELS)) {
      if (model.category === 'video') {
        expect(model.async, `${model.id} 应为异步`).toBe(true)
      }
      else {
        expect(model.async, `${model.id} 应为同步`).toBe(false)
      }
    }
  })

  it('文本模型定价包含 outputPrice', () => {
    const textModels = getModelsByCategory('text')
    for (const model of textModels) {
      expect(model.pricing.outputPrice, `${model.id} 文本模型缺少 outputPrice`).toBeDefined()
      expect(model.pricing.outputPrice).toBeGreaterThan(0)
    }
  })

  it('视频模型定价包含 inputPrice1080', () => {
    const videoModels = getModelsByCategory('video')
    for (const model of videoModels) {
      expect(model.pricing.inputPrice1080, `${model.id} 视频模型缺少 inputPrice1080`).toBeDefined()
    }
  })

  it('generation 类型的模型至少有 1 个必填参数（editing/understanding 可能全部可选）', () => {
    const generationModels = Object.values(MODELS).filter(m => m.type === 'generation')
    for (const model of generationModels) {
      const requiredParams = model.parameters.filter(p => p.required)
      expect(requiredParams.length, `${model.id} 生成类模型应有至少 1 个必填参数`).toBeGreaterThan(0)
    }
  })

  it('wan2.7-i2v 的 first_frame_url 为必填参数', () => {
    const i2v = getModelById('wan2.7-i2v')!
    const firstFrame = i2v.parameters.find(p => p.name === 'first_frame_url')
    expect(firstFrame).toBeDefined()
    expect(firstFrame!.required).toBe(true)
  })
})
