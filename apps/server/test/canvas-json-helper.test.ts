import { parseLLMJson } from '@excuse/prompt-engine'
import { describe, expect, it } from 'bun:test'

describe('parseLLMJson', () => {
  it('should parse clean JSON object', () => {
    const input = '{"name":"test","value":42}'
    const result = parseLLMJson<{ name: string, value: number }>(input)
    expect(result).toEqual({ name: 'test', value: 42 })
  })

  it('should parse clean JSON array', () => {
    const input = '[1,2,3]'
    const result = parseLLMJson<number[]>(input)
    expect(result).toEqual([1, 2, 3])
  })

  it('should strip markdown json code fence', () => {
    const input = '```json\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('should strip markdown code fence without language tag', () => {
    const input = '```\n{"key":"value"}\n```'
    const result = parseLLMJson<{ key: string }>(input)
    expect(result).toEqual({ key: 'value' })
  })

  it('should extract JSON from surrounding text', () => {
    const input = 'Here is the result:\n{"summary":"hello"}\nEnd of result.'
    const result = parseLLMJson<{ summary: string }>(input)
    expect(result).toEqual({ summary: 'hello' })
  })

  it('should extract JSON array of primitives from surrounding text', () => {
    const input = 'Result:\n["a","b","c"]\nDone.'
    const result = parseLLMJson<string[]>(input)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('should extract JSON array of objects from code fence', () => {
    const input = '```json\n[{"id":1},{"id":2}]\n```'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should extract JSON array of objects from surrounding text', () => {
    const input = 'Result:\n[{"id":1},{"id":2}]\nDone.'
    const result = parseLLMJson<Array<{ id: number }>>(input)
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('should handle nested JSON objects', () => {
    const input = '{"outer":{"inner":{"deep":true}},"arr":[1,2]}'
    const result = parseLLMJson<{ outer: { inner: { deep: boolean } }, arr: number[] }>(input)
    expect(result.outer.inner.deep).toBe(true)
    expect(result.arr).toEqual([1, 2])
  })

  it('should throw when no JSON found', () => {
    expect(() => parseLLMJson('no json here')).toThrow('Failed to extract JSON')
  })

  it('should throw with truncated input preview', () => {
    const longInput = 'x'.repeat(300)
    expect(() => parseLLMJson(longInput)).toThrow(longInput.slice(0, 200))
  })

  it('should handle whitespace-only input', () => {
    expect(() => parseLLMJson('   ')).toThrow('Failed to extract JSON')
  })

  it('should handle JSON in code fence with extra whitespace', () => {
    const input = '```json\n  \n  {"a": 1}  \n  \n```'
    const result = parseLLMJson<{ a: number }>(input)
    expect(result).toEqual({ a: 1 })
  })

  it('should handle real-world LLM output with preamble', () => {
    const input = `根据您的要求，分析结果如下：

\`\`\`json
{
  "summary": "一个关于少年的成长故事",
  "mainConflict": "内心的挣扎",
  "timeline": ["开端", "发展", "高潮"],
  "characterNames": ["小明", "小红"],
  "sceneNames": ["学校", "家"]
}
\`\`\`

希望这个分析对您有帮助。`
    const result = parseLLMJson<{
      summary: string
      mainConflict: string
      timeline: string[]
      characterNames: string[]
      sceneNames: string[]
    }>(input)
    expect(result.summary).toBe('一个关于少年的成长故事')
    expect(result.characterNames).toEqual(['小明', '小红'])
  })
})
