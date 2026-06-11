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
        inputPriceCents: m.pricing.inputPriceCents,
        outputPriceCents: m.pricing.outputPriceCents,
        inputPrice1080Cents: m.pricing.inputPrice1080Cents,
      },
      parameters: m.parameters,
      // 前端需要 referenceMediaType 来判断是否显示参考图上传卡片（r2v 模型）
      referenceMediaType: m.referenceMediaType,
    }))
    return { models }
  })
