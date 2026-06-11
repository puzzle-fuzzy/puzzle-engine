import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { calculateCost, estimateCost } from '../src/calculate'

// ── 测试用模型配置 ──────────────────────────────────────────

const textModel: ModelConfig = {
  id: 'test-text',
  name: '测试文本模型',
  category: 'text',
  type: 'generation',
  description: '',
  endpoint: '',
  async: false,
  pricing: { inputPrice: 2.4, outputPrice: 9.6, unit: 'token' },
  parameters: [],
}

const imageModel: ModelConfig = {
  id: 'test-image',
  name: '测试图片模型',
  category: 'image',
  type: 'generation',
  description: '',
  endpoint: '',
  async: false,
  pricing: { inputPrice: 0.25, unit: 'image' },
  parameters: [],
}

const videoModel: ModelConfig = {
  id: 'test-video',
  name: '测试视频模型',
  category: 'video',
  type: 'generation',
  description: '',
  endpoint: '',
  async: true,
  pricing: { inputPrice: 0.6, inputPrice1080: 1.0, unit: 'video' },
  parameters: [],
}

const videoModelNo1080: ModelConfig = {
  id: 'test-video-no1080',
  name: '测试视频模型(无1080P价格)',
  category: 'video',
  type: 'generation',
  description: '',
  endpoint: '',
  async: true,
  pricing: { inputPrice: 0.9, unit: 'video' },
  parameters: [],
}

const unknownModel: ModelConfig = {
  id: 'test-unknown',
  name: '测试未知模型',
  category: 'text',
  type: 'generation',
  description: '',
  endpoint: '',
  async: false,
  pricing: { inputPrice: 1, unit: 'other' as any },
  parameters: [],
}

// ── calculateCost ─────────────────────────────────────────

describe('calculateCost', () => {
  // ── 文本模型 (token 计费) ──

  describe('token 计费', () => {
    it('计算文本生成的标准费用', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 1000,
        outputTokens: 500,
      })

      expect(result).toEqual({
        unit: 'token',
        inputTokens: 1000,
        outputTokens: 500,
        inputUnitPrice: 2.4,
        outputUnitPrice: 9.6,
        inputCost: 0.0024, // 1000/1M * 2.4
        outputCost: 0.0048, // 500/1M * 9.6
        totalPrice: 0.0072,
      })
    })

    it('usage 为空时 token 数为 0，费用为 0', () => {
      const result = calculateCost(textModel, {})

      expect(result).toEqual({
        unit: 'token',
        inputTokens: 0,
        outputTokens: 0,
        inputUnitPrice: 2.4,
        outputUnitPrice: 9.6,
        inputCost: 0,
        outputCost: 0,
        totalPrice: 0,
      })
    })

    it('只提供 inputTokens 时 outputTokens 默认为 0', () => {
      const result = calculateCost(textModel, {}, { inputTokens: 500_000 })

      expect(result.inputTokens).toBe(500_000)
      expect(result.outputTokens).toBe(0)
      expect(result.inputCost).toBe(1.2) // 500K/1M * 2.4
      expect(result.outputCost).toBe(0)
      expect(result.totalPrice).toBe(1.2)
    })

    it('处理大额 token 数量', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })

      expect(result.inputCost).toBe(2.4)
      expect(result.outputCost).toBe(9.6)
      expect(result.totalPrice).toBe(12)
    })

    it('结果精确到小数点后 4 位', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 1,
        outputTokens: 1,
      })

      // 1/1M * 2.4 = 0.0000024 → roundTo4 → 0
      // 1/1M * 9.6 = 0.0000096 → roundTo4 → 0
      expect(result.inputCost).toBe(0)
      expect(result.outputCost).toBe(0)
      expect(result.totalPrice).toBe(0)
    })

    it('roundTo4 保留 4 位小数', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 100,
        outputTokens: 200,
      })

      // 100/1M * 2.4 = 0.00024 → roundTo4 → 0.0002
      // 200/1M * 9.6 = 0.00192 → roundTo4 → 0.0019
      // sum = 0.0002 + 0.0019 = 0.0021 → 但 total 直接求和再 roundTo4
      // sum 原始 = 0.00024 + 0.00192 = 0.00216 → roundTo4 → 0.0022
      expect(result.inputCost).toBe(0.0002)
      expect(result.outputCost).toBe(0.0019)
      expect(result.totalPrice).toBe(0.0022)
    })
  })

  // ── 图片模型 (image 计费) ──

  describe('image 计费', () => {
    it('默认生成 1 张图片', () => {
      const result = calculateCost(imageModel, {})

      expect(result).toEqual({
        unit: 'image',
        quantity: 1,
        unitPrice: 0.25,
        totalPrice: 0.25,
      })
    })

    it('通过 usage.imageCount 指定数量', () => {
      const result = calculateCost(imageModel, {}, { imageCount: 4 })

      expect(result.quantity).toBe(4)
      expect(result.totalPrice).toBe(1) // 4 * 0.25
    })

    it('通过 params.n 指定数量', () => {
      const result = calculateCost(imageModel, { n: 3 })

      expect(result.quantity).toBe(3)
      expect(result.totalPrice).toBe(0.75)
    })

    it('usage.imageCount 优先于 params.n', () => {
      const result = calculateCost(imageModel, { n: 3 }, { imageCount: 2 })

      expect(result.quantity).toBe(2)
      expect(result.totalPrice).toBe(0.5)
    })
  })

  // ── 视频模型 (video 计费) ──

  describe('video 计费', () => {
    it('默认 720P 分辨率', () => {
      const result = calculateCost(videoModel, {}, { videoDuration: 5 })

      expect(result).toEqual({
        unit: 'video',
        duration: 5,
        resolution: '720P',
        unitPrice: 0.6,
        totalPrice: 3, // 5 * 0.6
      })
    })

    it('1080P 使用 inputPrice1080', () => {
      const result = calculateCost(videoModel, { resolution: '1080P' }, { videoDuration: 10 })

      expect(result.resolution).toBe('1080P')
      expect(result.unitPrice).toBe(1.0)
      expect(result.totalPrice).toBe(10) // 10 * 1.0
    })

    it('1080P 无 inputPrice1080 时回退到 inputPrice', () => {
      const result = calculateCost(videoModelNo1080, { resolution: '1080P' }, { videoDuration: 5 })

      expect(result.unitPrice).toBe(0.9)
      expect(result.totalPrice).toBe(4.5) // 5 * 0.9
    })

    it('通过 params.duration 指定时长', () => {
      const result = calculateCost(videoModel, { duration: 15 })

      expect(result.duration).toBe(15)
      expect(result.totalPrice).toBe(9) // 15 * 0.6
    })

    it('usage.videoDuration 优先于 params.duration', () => {
      const result = calculateCost(videoModel, { duration: 15 }, { videoDuration: 8 })

      expect(result.duration).toBe(8)
      expect(result.totalPrice).toBe(4.8) // 8 * 0.6
    })

    it('默认时长为 5 秒', () => {
      const result = calculateCost(videoModel, {})

      expect(result.duration).toBe(5)
    })
  })

  // ── 未知计费类型 ──

  describe('未知计费类型', () => {
    it('应抛出错误', () => {
      expect(() => calculateCost(unknownModel, {})).toThrow(/未知的计费单位/)
    })
  })
})

// ── estimateCost ─────────────────────────────────────────

describe('estimateCost', () => {
  it('不传 usage，使用默认值进行预估', () => {
    const result = estimateCost(textModel, {})

    expect(result.unit).toBe('token')
    expect(result.totalPrice).toBe(0) // 无 token 消耗
  })

  it('图片预估使用 params.n 作为数量', () => {
    const result = estimateCost(imageModel, { n: 6 })

    expect(result.quantity).toBe(6)
    expect(result.totalPrice).toBe(1.5)
  })

  it('视频预估使用 params 中的 duration 和 resolution', () => {
    const result = estimateCost(videoModel, { duration: 10, resolution: '1080P' })

    expect(result.unit).toBe('video')
    expect(result.duration).toBe(10)
    expect(result.resolution).toBe('1080P')
    expect(result.totalPrice).toBe(10)
  })
})
