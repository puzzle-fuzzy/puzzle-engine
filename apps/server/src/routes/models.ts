import { MODELS } from '@excuse/provider'
import { Elysia } from 'elysia'

export const modelsRoutes = new Elysia({ prefix: '/api/models' })
  .get('/', () => {
    const models = Object.values(MODELS).map(m => ({
      id: m.id,
      name: m.name,
      category: m.category,
      type: m.type,
      description: m.description,
      async: m.async,
      pricing: {
        unit: m.pricing.unit,
        note: m.pricing.note,
        inputPrice: m.pricing.inputPrice,
        outputPrice: m.pricing.outputPrice,
        inputPrice1080: m.pricing.inputPrice1080,
      },
      parameters: m.parameters,
      // 前端需要 referenceMediaType 来判断是否显示参考图上传卡片（r2v 模型）
      referenceMediaType: m.referenceMediaType,
    }))
    return { models }
  })
