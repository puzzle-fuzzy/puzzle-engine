import type { ModelConfig } from '../src/api/client'
import { beforeEach, describe, expect, it } from 'vitest'
import { buildInitialParameters, checkCanGenerate, useWorkspaceStore } from '../src/stores/workspace'

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'model-1',
    name: 'Model 1',
    category: 'image',
    type: 'generation',
    description: 'test model',
    endpoint: '/test',
    async: false,
    pricing: { inputPriceCents: 1, unit: 'image' },
    parameters: [
      { name: 'prompt', type: 'text', required: true },
      { name: 'n', type: 'number', defaultValue: 2 },
      { name: 'watermark', type: 'boolean', defaultValue: true },
      { name: 'size', type: 'select', defaultValue: '1024*1024' },
    ],
    ...overrides,
  }
}

describe('workspace store parameters', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      models: [],
      selectedCategory: 'image',
      selectedModelId: '',
      parameters: {},
      referenceFiles: [],
      mediaUploadState: {},
      loading: false,
      uploadingRefs: false,
    })
  })

  it('builds typed initial parameters from model config defaults', () => {
    expect(buildInitialParameters(makeModel())).toEqual({
      prompt: '',
      n: 2,
      watermark: true,
      size: '1024*1024',
    })
  })

  it('checks required parameters against workspace parameters', () => {
    const model = makeModel()

    expect(checkCanGenerate(model, buildInitialParameters(model))).toBe(false)
    expect(checkCanGenerate(model, { ...buildInitialParameters(model), prompt: 'hello' })).toBe(true)
  })

  it('normalizes setParameter values using the selected model parameter type', () => {
    const model = makeModel()
    useWorkspaceStore.setState({
      models: [model],
      selectedModelId: model.id,
      parameters: buildInitialParameters(model),
    })

    useWorkspaceStore.getState().setParameter('n', 'bad-number')
    useWorkspaceStore.getState().setParameter('watermark', 'yes')
    useWorkspaceStore.getState().setParameter('prompt', 123)
    useWorkspaceStore.getState().setParameter('unknown-field', 'ignored')

    expect(useWorkspaceStore.getState().parameters).toEqual({
      prompt: '123',
      n: 2,
      watermark: true,
      size: '1024*1024',
    })
  })
})
