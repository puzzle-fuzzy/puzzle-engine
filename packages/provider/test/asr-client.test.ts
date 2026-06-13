import { describe, expect, it } from 'bun:test'
import { ASRClient } from '../src/asr-client'

// ── parseTranscription ──────────────────────────────────
// 纯逻辑测试，无需网络，不涉及 submitTranscription/queryTask

describe('ASRClient.parseTranscription', () => {
  const client = new ASRClient({ apiKey: 'test-key' })

  it('返回空数组当输入为 null', () => {
    expect(client.parseTranscription(null)).toEqual([])
  })

  it('返回空数组当输入为 undefined', () => {
    expect(client.parseTranscription(undefined)).toEqual([])
  })

  it('返回空数组当输入为非对象', () => {
    expect(client.parseTranscription('string')).toEqual([])
    expect(client.parseTranscription(42)).toEqual([])
  })

  it('返回空数组当输入缺少 transcripts 字段', () => {
    expect(client.parseTranscription({})).toEqual([])
    expect(client.parseTranscription({ other: 'data' })).toEqual([])
  })

  it('返回空数组当 transcripts 不是数组', () => {
    expect(client.parseTranscription({ transcripts: 'not-array' })).toEqual([])
    expect(client.parseTranscription({ transcripts: {} })).toEqual([])
  })

  it('解析单个 transcript 的句子列表', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '你好世界', begin_time: 0, end_time: 2000 },
            { text: '欢迎来到这里', begin_time: 2000, end_time: 5000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('你好世界')
    expect(result[0]!.beginTime).toBe(0)
    expect(result[0]!.endTime).toBe(2000)
    expect(result[1]!.text).toBe('欢迎来到这里')
    expect(result[1]!.beginTime).toBe(2000)
    expect(result[1]!.endTime).toBe(5000)
  })

  it('解析带 speakerId 的句子', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '说话人1', begin_time: 0, end_time: 1000, speaker_id: 0 },
            { text: '说话人2', begin_time: 1000, end_time: 2000, speaker_id: 1 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.speakerId).toBe(0)
    expect(result[1]!.speakerId).toBe(1)
  })

  it('省略 speakerId 当不是 number 类型', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '你好', begin_time: 0, end_time: 1000 },
            { text: '世界', begin_time: 1000, end_time: 2000, speaker_id: 'spk1' },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.speakerId).toBeUndefined()
    expect(result[1]!.speakerId).toBeUndefined()
  })

  it('合并多个 transcript 的句子', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '通道1句1', begin_time: 0, end_time: 1000 },
          ],
        },
        {
          sentences: [
            { text: '通道2句1', begin_time: 500, end_time: 1500 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(2)
    expect(result[0]!.text).toBe('通道1句1')
    expect(result[1]!.text).toBe('通道2句1')
  })

  it('跳过缺少 sentences 数组的 transcript', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [{ text: '有效句', begin_time: 0, end_time: 1000 }],
        },
        {
          // 没有 sentences 字段
          text: '整体文本',
        },
        {
          sentences: 'not-array',
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result).toHaveLength(1)
    expect(result[0]!.text).toBe('有效句')
  })

  it('text 不是字符串时默认为空字符串', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: null, begin_time: 0, end_time: 1000 },
            { text: 123, begin_time: 1000, end_time: 2000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.text).toBe('')
    expect(result[1]!.text).toBe('')
  })

  it('begin_time / end_time 不是数字时默认为 0', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '缺失时间', begin_time: 'bad', end_time: null },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.beginTime).toBe(0)
    expect(result[0]!.endTime).toBe(0)
  })

  it('每个句子都有唯一 id', () => {
    const rawJson = {
      transcripts: [
        {
          sentences: [
            { text: '句1', begin_time: 0, end_time: 1000 },
            { text: '句2', begin_time: 1000, end_time: 2000 },
          ],
        },
      ],
    }

    const result = client.parseTranscription(rawJson)

    expect(result[0]!.id).toBeTruthy()
    expect(result[1]!.id).toBeTruthy()
    expect(result[0]!.id).not.toBe(result[1]!.id)
  })

  it('空 transcripts 数组返回空句子列表', () => {
    expect(client.parseTranscription({ transcripts: [] })).toEqual([])
  })

  it('空 sentences 数组不产生输出', () => {
    expect(client.parseTranscription({ transcripts: [{ sentences: [] }] })).toEqual([])
  })
})
