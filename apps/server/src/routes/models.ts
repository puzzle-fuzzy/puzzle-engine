import { Elysia } from 'elysia'
import { MODELS } from '@excuse/provider'

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
    }))
    return { models }
  })
