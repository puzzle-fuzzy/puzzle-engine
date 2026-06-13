import type { ValidatedModelParameters } from '@excuse/provider'
import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it, mock } from 'bun:test'
import { runTextLlmOnce } from '../src/llm-helpers'

const textModel: ModelConfig = {
  id: 'qwen-test',
  name: 'Qwen Test',
  category: 'text',
  type: 'generation',
  description: 'test text model',
  endpoint: '/test',
  async: false,
  pricing: { inputPriceCents: 0, outputPriceCents: 0, unit: 'token' },
  parameters: [
    { name: 'prompt', type: 'text', required: true },
    { name: 'temperature', type: 'number', defaultValue: 0.7 },
    { name: 'max_tokens', type: 'number', defaultValue: 1500 },
  ],
}

function asValidated(params: Record<string, unknown>): ValidatedModelParameters {
  return params as ValidatedModelParameters
}

describe('runTextLlmOnce', () => {
  it('builds the prompt, validates params, calls chat, and returns the raw text', async () => {
    const chatCompletion = mock<(model: string, params: ValidatedModelParameters) => Promise<unknown>>(() =>
      Promise.resolve({ type: 'text', success: true, model: 'qwen-test', output: { text: 'LLM 原始输出' } }),
    )
    const client = { chatCompletion } as never

    const text = await runTextLlmOnce({
      client,
      textModel: 'qwen-test',
      systemPrompt: 'SYSTEM',
      userPrompt: 'USER',
      maxTokens: 4096,
      failureMessage: '失败',
      deps: {
        getModelById: id => (id === 'qwen-test' ? textModel : undefined),
        validateAndMerge: (_config, params) => ({ ok: true as const, params: asValidated(params) }),
      },
    })

    expect(text).toBe('LLM 原始输出')
    expect(chatCompletion).toHaveBeenCalledTimes(1)
    const [, params] = chatCompletion.mock.calls[0]!
    expect((params as Record<string, unknown>).prompt).toBe('SYSTEM\n\nUSER')
    expect((params as Record<string, unknown>).max_tokens).toBe(4096)
  })

  it('throws when the text model is unknown', async () => {
    await expect(runTextLlmOnce({
      client: {} as never,
      textModel: 'missing',
      systemPrompt: '',
      userPrompt: '',
      maxTokens: 100,
      failureMessage: 'x',
      deps: {
        getModelById: () => undefined,
        validateAndMerge: (_config, params) => ({ ok: true as const, params: asValidated(params) }),
      },
    })).rejects.toThrow('未知文本模型')
  })

  it('throws on provider validation failure with field detail', async () => {
    await expect(runTextLlmOnce({
      client: {} as never,
      textModel: 'qwen-test',
      systemPrompt: '',
      userPrompt: '',
      maxTokens: 100,
      failureMessage: 'x',
      deps: {
        getModelById: () => textModel,
        validateAndMerge: () => ({ ok: false as const, errors: [{ field: 'max_tokens', message: 'too large' }] }),
      },
    })).rejects.toThrow('参数校验失败：max_tokens: too large')
  })

  it('throws the failureMessage when chat returns a failed result', async () => {
    const client = {
      chatCompletion: () => Promise.resolve({ type: 'failed', success: false, error: 'provider down' }),
    } as never

    await expect(runTextLlmOnce({
      client,
      textModel: 'qwen-test',
      systemPrompt: '',
      userPrompt: '',
      maxTokens: 100,
      failureMessage: '分析失败',
      deps: {
        getModelById: () => textModel,
        validateAndMerge: (_config, params) => ({ ok: true as const, params: asValidated(params) }),
      },
    })).rejects.toThrow('provider down')
  })
})
