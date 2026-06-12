import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { prepareCanvasVideoParams } from '../src/modules/canvas/videos'

const baseVideoModel: ModelConfig = {
  id: 'test-video',
  name: 'Test Video',
  category: 'video',
  type: 'generation',
  description: 'test video model',
  endpoint: '/test',
  async: true,
  pricing: { inputPriceCents: 100, unit: 'video' },
  parameters: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'resolution', type: 'select', required: true, options: [{ label: '720P', value: '720P' }] },
    { name: 'duration', type: 'number', required: true, min: 1, max: 10 },
  ],
}

const modelWithNegativePrompt: ModelConfig = {
  ...baseVideoModel,
  id: 'test-video-negative',
  parameters: [
    ...baseVideoModel.parameters,
    { name: 'negative_prompt', type: 'text' },
  ],
}

/** Helper: branded type constructor — casts validated Record to ValidatedModelParameters */
function asValidated(params: Record<string, unknown>): ValidatedModelParameters {
  return params as ValidatedModelParameters
}

function makeDeps(modelConfig: ModelConfig, overrides?: {
  mergeWithDefaults?: (modelConfig: ModelConfig, params: Record<string, unknown>) => Record<string, unknown>
}) {
  const mergeWithDefaults = overrides?.mergeWithDefaults ?? ((_modelConfig: ModelConfig, params: Record<string, unknown>) => params)
  return {
    getModelById: (model: string) => model === modelConfig.id ? modelConfig : undefined,
    validateAndMerge: (config: ModelConfig, params: Record<string, unknown>) => {
      const errors: Array<{ field: string, message: string }> = []

      if (typeof params.duration === 'number' && params.duration > 10) {
        errors.push({ field: 'duration', message: 'duration is too large' })
      }

      for (const key of Object.keys(params)) {
        if (!config.parameters.some(param => param.name === key))
          errors.push({ field: key, message: 'unknown parameter' })
      }

      if (errors.length > 0) {
        return { ok: false as const, errors }
      }
      return { ok: true as const, params: asValidated(mergeWithDefaults(config, params)) }
    },
    validateModelParameters: (config: ModelConfig, params: Record<string, unknown>) => {
      const errors: Array<{ field: string, message: string }> = []

      if (typeof params.duration === 'number' && params.duration > 10) {
        errors.push({ field: 'duration', message: 'duration is too large' })
      }

      for (const key of Object.keys(params)) {
        if (!config.parameters.some(param => param.name === key))
          errors.push({ field: key, message: 'unknown parameter' })
      }

      return { valid: errors.length === 0, errors }
    },
  }
}

describe('canvas videos', () => {
  describe('prepareCanvasVideoParams', () => {
    it('omits negative_prompt when the selected video model does not declare it', () => {
      const { params } = prepareCanvasVideoParams('test-video', {
        videoPrompt: 'stable cinematic shot',
        negativePrompt: 'no shake',
        duration: 5,
      }, makeDeps(baseVideoModel))

      expect(params.prompt).toBe('stable cinematic shot')
      expect(params.resolution).toBe('720P')
      expect(params.duration).toBe(5)
      expect(params.negative_prompt).toBeUndefined()
    })

    it('keeps negative_prompt when the selected video model declares it', () => {
      const { params } = prepareCanvasVideoParams('test-video-negative', {
        videoPrompt: 'stable cinematic shot',
        negativePrompt: 'no shake',
        duration: 5,
      }, makeDeps(modelWithNegativePrompt))

      expect(params.prompt).toBe('stable cinematic shot')
      expect(params.negative_prompt).toBe('no shake')
    })

    it('rejects invalid duration before submitting a provider task', () => {
      expect(() =>
        prepareCanvasVideoParams('test-video', {
          videoPrompt: 'stable cinematic shot',
          duration: 99,
        }, makeDeps(baseVideoModel)),
      ).toThrow('视频参数校验失败')
    })

    it('rejects malformed parameters after provider defaults are merged', () => {
      expect(() =>
        prepareCanvasVideoParams('test-video', {
          videoPrompt: 'stable cinematic shot',
          duration: 5,
        }, makeDeps(baseVideoModel, {
          mergeWithDefaults: (_modelConfig, params) => ({ ...params, resolution: '4K' }),
        })),
      ).toThrow('resolution 必须是 720P 或 1080P')
    })
  })
})
