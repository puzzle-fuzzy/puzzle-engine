import type { ModelConfig } from '@excuse/shared'
import { describe, expect, it } from 'bun:test'
import { calculateCost, estimateCost } from '../src/calculate'

// ── 测试用模型配置（分制定价）──────────────────────────────

const textModel: ModelConfig = {
  id: 'test-text',
  name: '测试文本模型',
  category: 'text',
  type: 'generation',
  description: '',
  endpoint: '',
  async: false,
  pricing: { inputPriceCents: 240, outputPriceCents: 960, unit: 'token' },
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
  pricing: { inputPriceCents: 25, unit: 'image' },
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
  pricing: { inputPriceCents: 60, inputPrice1080Cents: 100, unit: 'video' },
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
  pricing: { inputPriceCents: 90, unit: 'video' },
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

      // inputCostCents = 1000/1M * 240 = 0.24分
      // outputCostCents = 500/1M * 960 = 0.48分
      // totalCents = 0.72分 → totalPrice = 0.0072元
      expect(result).toEqual({
        unit: 'token',
        inputTokens: 1000,
        outputTokens: 500,
        inputUnitPriceCents: 240,
        inputUnitPrice: 2.4,
        outputUnitPriceCents: 960,
        outputUnitPrice: 9.6,
        inputCostCents: 0.24,
        inputCost: 0.0024,
        outputCostCents: 0.48,
        outputCost: 0.0048,
        totalPriceCents: 0.72,
        totalPrice: 0.0072,
      })
    })

    it('usage 为空时 token 数为 0，费用为 0', () => {
      const result = calculateCost(textModel, {})

      expect(result).toEqual({
        unit: 'token',
        inputTokens: 0,
        outputTokens: 0,
        inputUnitPriceCents: 240,
        inputUnitPrice: 2.4,
        outputUnitPriceCents: 960,
        outputUnitPrice: 9.6,
        inputCostCents: 0,
        inputCost: 0,
        outputCostCents: 0,
        outputCost: 0,
        totalPriceCents: 0,
        totalPrice: 0,
      })
    })

    it('只提供 inputTokens 时 outputTokens 默认为 0', () => {
      const result = calculateCost(textModel, {}, { inputTokens: 500_000 })

      // inputCostCents = 500K/1M * 240 = 120分 → inputCost = 1.2元
      expect(result.inputTokens).toBe(500_000)
      expect(result.outputTokens).toBe(0)
      expect(result.inputCostCents).toBe(120)
      expect(result.inputCost).toBe(1.2)
      expect(result.outputCostCents).toBe(0)
      expect(result.outputCost).toBe(0)
      expect(result.totalPriceCents).toBe(120)
      expect(result.totalPrice).toBe(1.2)
    })

    it('处理大额 token 数量', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      })

      // inputCostCents = 1M/1M * 240 = 240分 → inputCost = 2.4元
      // outputCostCents = 1M/1M * 960 = 960分 → outputCost = 9.6元
      expect(result.inputCostCents).toBe(240)
      expect(result.inputCost).toBe(2.4)
      expect(result.outputCostCents).toBe(960)
      expect(result.outputCost).toBe(9.6)
      expect(result.totalPriceCents).toBe(1200)
      expect(result.totalPrice).toBe(12)
    })

    it('1 token 产生的分值不为 0', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 1,
        outputTokens: 1,
      })

      // 1/1M * 240 = 0.00024分
      // 1/1M * 960 = 0.00096分
      // totalCents = 0.0012分 → totalPrice = 0.000012元 → roundTo4 → 0
      expect(result.inputCostCents).toBe(0.0002)
      expect(result.inputCost).toBe(0)
      expect(result.outputCostCents).toBe(0.001)
      expect(result.outputCost).toBe(0)
      expect(result.totalPriceCents).toBe(0.0012)
      expect(result.totalPrice).toBe(0)
    })

    it('currency.js 保证分值精度', () => {
      const result = calculateCost(textModel, {}, {
        inputTokens: 100,
        outputTokens: 200,
      })

      // 100/1M * 240 = 0.024分
      // 200/1M * 960 = 0.192分
      // totalCents = 0.216分 → totalPrice = 0.00216元 → currency roundTo2 → 0.0022元
      expect(result.inputCostCents).toBe(0.024)
      expect(result.inputCost).toBe(0.0002)
      expect(result.outputCostCents).toBe(0.192)
      expect(result.outputCost).toBe(0.0019)
      expect(result.totalPriceCents).toBe(0.216)
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
        unitPriceCents: 25,
        unitPrice: 0.25,
        totalPriceCents: 25,
        totalPrice: 0.25,
      })
    })

    it('通过 usage.imageCount 指定数量', () => {
      const result = calculateCost(imageModel, {}, { imageCount: 4 })

      expect(result.quantity).toBe(4)
      expect(result.totalPriceCents).toBe(100)
      expect(result.totalPrice).toBe(1)
    })

    it('通过 params.n 指定数量', () => {
      const result = calculateCost(imageModel, { n: 3 })

      expect(result.quantity).toBe(3)
      expect(result.totalPriceCents).toBe(75)
      expect(result.totalPrice).toBe(0.75)
    })

    it('usage.imageCount 优先于 params.n', () => {
      const result = calculateCost(imageModel, { n: 3 }, { imageCount: 2 })

      expect(result.quantity).toBe(2)
      expect(result.totalPriceCents).toBe(50)
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
        unitPriceCents: 60,
        unitPrice: 0.6,
        totalPriceCents: 300,
        totalPrice: 3,
      })
    })

    it('1080P 使用 inputPrice1080Cents', () => {
      const result = calculateCost(videoModel, { resolution: '1080P' }, { videoDuration: 10 })

      expect(result.resolution).toBe('1080P')
      expect(result.unitPriceCents).toBe(100)
      expect(result.unitPrice).toBe(1)
      expect(result.totalPriceCents).toBe(1000)
      expect(result.totalPrice).toBe(10)
    })

    it('1080P 无 inputPrice1080Cents 时回退到 inputPriceCents', () => {
      const result = calculateCost(videoModelNo1080, { resolution: '1080P' }, { videoDuration: 5 })

      expect(result.unitPriceCents).toBe(90)
      expect(result.unitPrice).toBe(0.9)
      expect(result.totalPriceCents).toBe(450)
      expect(result.totalPrice).toBe(4.5)
    })

    it('通过 params.duration 指定时长', () => {
      const result = calculateCost(videoModel, { duration: 15 })

      expect(result.duration).toBe(15)
      expect(result.totalPriceCents).toBe(900)
      expect(result.totalPrice).toBe(9)
    })

    it('usage.videoDuration 优先于 params.duration', () => {
      const result = calculateCost(videoModel, { duration: 15 }, { videoDuration: 8 })

      expect(result.duration).toBe(8)
      expect(result.totalPriceCents).toBe(480)
      expect(result.totalPrice).toBe(4.8)
    })

    it('默认时长为 5 秒', () => {
      const result = calculateCost(videoModel, {})

      expect(result.duration).toBe(5)
    })
  })

  // ── 未知计费类型 ──

  describe('未知计费类型', () => {
    it('应抛出错误', () => {
      expect(() => calculateCost({
        id: 'x',
        name: '',
        category: 'text',
        type: 'generation',
        description: '',
        endpoint: '',
        async: false,
        pricing: { inputPriceCents: 100, unit: 'other' as 'token' | 'image' | 'video' },
        parameters: [],
      }, {})).toThrow(/未知的计费单位/)
    })
  })
})

// ── estimateCost ─────────────────────────────────────────

describe('estimateCost', () => {
  it('不传 usage，使用默认值进行预估', () => {
    const result = estimateCost(textModel, {})

    expect(result.unit).toBe('token')
    expect(result.totalPriceCents).toBe(0)
    expect(result.totalPrice).toBe(0)
    expect(result.estimated).toBe(true)
  })

  it('图片预估使用 params.n 作为数量', () => {
    const result = estimateCost(imageModel, { n: 6 })

    expect(result.quantity).toBe(6)
    expect(result.totalPriceCents).toBe(150)
    expect(result.totalPrice).toBe(1.5)
    expect(result.estimated).toBe(true)
  })

  it('视频预估使用 params 中的 duration 和 resolution', () => {
    const result = estimateCost(videoModel, { duration: 10, resolution: '1080P' })

    expect(result.unit).toBe('video')
    expect(result.duration).toBe(10)
    expect(result.resolution).toBe('1080P')
    expect(result.unitPriceCents).toBe(100)
    expect(result.totalPriceCents).toBe(1000)
    expect(result.totalPrice).toBe(10)
    expect(result.estimated).toBe(true)
  })
})
