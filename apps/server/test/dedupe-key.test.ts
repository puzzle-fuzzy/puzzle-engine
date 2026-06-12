import { describe, expect, it } from 'bun:test'
import { __test, createDedupeKey } from '../src/utils/dedupe-key'

describe('dedupe key', () => {
  it('uses canonical object key order', async () => {
    const first = await createDedupeKey({
      accountId: 'acc-001',
      model: 'qwen-max',
      parameters: { prompt: '你好', temperature: 0.7, nested: { b: 2, a: 1 } },
    })

    const second = await createDedupeKey({
      accountId: 'acc-001',
      model: 'qwen-max',
      parameters: { nested: { a: 1, b: 2 }, temperature: 0.7, prompt: '你好' },
    })

    expect(first).toBe(second)
    expect(first).toStartWith('sha256:')
  })

  it('changes when reference files change', async () => {
    const base = {
      accountId: 'acc-001',
      model: 'qwen-image-2.0-pro',
      parameters: { prompt: 'same prompt' },
    }

    const withoutReference = await createDedupeKey(base)
    const withReference = await createDedupeKey({ ...base, referenceFileIds: ['file-001'] })

    expect(withReference).not.toBe(withoutReference)
  })

  it('drops undefined object fields like JSON.stringify but keeps array positions stable', () => {
    expect(__test.canonicalStringify({ b: 2, a: undefined, c: [1, undefined] })).toBe('{"b":2,"c":[1,null]}')
  })
})
