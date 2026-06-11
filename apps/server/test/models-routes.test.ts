import { treaty } from '@elysia/eden'
import { beforeEach, describe, expect, it, mock } from 'bun:test'

/**
 * 模型列表路由测试
 *
 * Mock @excuse/provider 的 MODELS，验证 GET /api/models/ 返回格式
 */

const MOCK_MODELS: Record<string, Record<string, unknown>> = {
  'qwen-max': {
    id: 'qwen-max',
    name: '千问 Max',
    category: 'text',
    type: 'generation',
    description: '最强文本',
    endpoint: 'https://api.test',
    async: false,
    pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token', note: '标准定价' },
    parameters: [{ name: 'prompt', type: 'text', required: true }],
  },
  'qwen-image-2.0-pro': {
    id: 'qwen-image-2.0-pro',
    name: '千问图像',
    category: 'image',
    type: 'generation',
    description: '最强图像',
    endpoint: 'https://api.test',
    async: false,
    pricing: { inputPriceCents: 25, unit: 'image', note: '0.25元/张' },
    parameters: [{ name: 'prompt', type: 'text', required: true }],
  },
  'happyhorse-1.0-t2v': {
    id: 'happyhorse-1.0-t2v',
    name: '视频',
    category: 'video',
    type: 'generation',
    description: '视频生成',
    endpoint: 'https://api.test',
    async: true,
    pricing: { inputPriceCents: 90, inputPrice1080Cents: 160, unit: 'video' },
    parameters: [{ name: 'prompt', type: 'text', required: true }],
  },
}

mock.module('@excuse/provider', () => ({
  MODELS: MOCK_MODELS,
}))

// eslint-disable-next-line import/first
import { modelsRoutes } from '../src/routes/models'

describe('models routes', () => {
  let client: ReturnType<typeof treaty>

  beforeEach(() => {
    const app = modelsRoutes
    client = treaty(app)
  })

  it('GET / 返回所有模型列表', async () => {
    const { data, error } = await client.api.models.get()

    expect(error).toBeNull()
    expect(data?.models).toHaveLength(3)
  })

  it('每个模型包含 id/name/category/type/pricing/parameters', async () => {
    const { data } = await client.api.models.get()

    for (const model of data!.models) {
      expect(model.id).toBeTruthy()
      expect(model.name).toBeTruthy()
      expect(['text', 'image', 'video']).toContain(model.category)
      expect(model.pricing).toBeDefined()
      expect(model.parameters).toBeInstanceOf(Array)
    }
  })

  it('pricing 字段过滤了敏感信息（不暴露 endpoint）', async () => {
    const { data } = await client.api.models.get()

    for (const model of data!.models) {
      expect((model as any).endpoint).toBeUndefined()
      expect((model as any).inputMapping).toBeUndefined()
      expect((model as any).requestType).toBeUndefined()
    }
  })

  it('pricing 包含 unit/inputPriceCents/outputPriceCents 信息', async () => {
    const { data } = await client.api.models.get()

    const models = data!.models as Array<Record<string, unknown>>
    const textModel = models.find((m): m is Record<string, unknown> => m.id === 'qwen-max')
    expect(textModel).toBeDefined()
    expect((textModel!.pricing as Record<string, unknown>).unit).toBe('token')
    expect((textModel!.pricing as Record<string, unknown>).inputPriceCents).toBe(240)
    expect((textModel!.pricing as Record<string, unknown>).outputPriceCents).toBe(960)

    const imageModel = models.find((m): m is Record<string, unknown> => m.id === 'qwen-image-2.0-pro')
    expect((imageModel!.pricing as Record<string, unknown>).unit).toBe('image')

    const videoModel = models.find((m): m is Record<string, unknown> => m.id === 'happyhorse-1.0-t2v')
    expect((videoModel!.pricing as Record<string, unknown>).inputPrice1080Cents).toBe(160)
  })
})
