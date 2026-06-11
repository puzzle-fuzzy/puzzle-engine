import type { CostDetail, ModelConfig } from '@excuse/shared'
import currency from 'currency.js'

const PRECISION = { precision: 4 }

/**
 * 计算单次生成的费用（分计费）
 *
 * - 文本：按输入/输出 token 数 × 每百万 token 价格（分）
 * - 图片：按张数 × 单价（分）
 * - 视频：按时长（秒）× 单价（分，按分辨率）
 *
 * 所有金额运算使用 currency.js（precision=4），避免浮点误差。
 * totalPriceCents 为权威值，totalPrice 为分→元的兼容展示值。
 */
export function calculateCost(
  model: ModelConfig,
  params: Record<string, unknown>,
  usage?: {
    inputTokens?: number
    outputTokens?: number
    imageCount?: number
    videoDuration?: number
  },
): CostDetail {
  const pricing = model.pricing

  switch (pricing.unit) {
    case 'token': {
      const inputTokens = usage?.inputTokens || 0
      const outputTokens = usage?.outputTokens || 0

      const inputCostCents = currency(pricing.inputPriceCents, PRECISION)
        .multiply(inputTokens)
        .divide(1_000_000)
        .value
      const outputCostCents = currency(pricing.outputPriceCents || 0, PRECISION)
        .multiply(outputTokens)
        .divide(1_000_000)
        .value
      const totalCents = currency(inputCostCents, PRECISION).add(outputCostCents).value

      return {
        unit: 'token',
        inputTokens,
        outputTokens,
        inputUnitPriceCents: pricing.inputPriceCents,
        inputUnitPrice: centsToYuan(pricing.inputPriceCents),
        outputUnitPriceCents: pricing.outputPriceCents,
        outputUnitPrice: pricing.outputPriceCents ? centsToYuan(pricing.outputPriceCents) : undefined,
        inputCostCents,
        inputCost: centsToYuan(inputCostCents),
        outputCostCents,
        outputCost: centsToYuan(outputCostCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    case 'image': {
      const count = usage?.imageCount || (typeof params.n === 'number' ? params.n : 1)
      const totalCents = currency(pricing.inputPriceCents, PRECISION).multiply(count).value

      return {
        unit: 'image',
        quantity: count,
        unitPriceCents: pricing.inputPriceCents,
        unitPrice: centsToYuan(pricing.inputPriceCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    case 'video': {
      const duration = usage?.videoDuration || (typeof params.duration === 'number' ? params.duration : 5)
      const resolution = typeof params.resolution === 'string' ? params.resolution : '720P'
      const unitPriceCents = resolution === '1080P'
        ? (pricing.inputPrice1080Cents || pricing.inputPriceCents)
        : pricing.inputPriceCents
      const totalCents = currency(unitPriceCents, PRECISION).multiply(duration).value

      return {
        unit: 'video',
        duration,
        resolution,
        unitPriceCents,
        unitPrice: centsToYuan(unitPriceCents),
        totalPriceCents: totalCents,
        totalPrice: centsToYuan(totalCents),
      }
    }

    default:
      throw new Error(`未知的计费单位: ${pricing.unit}`)
  }
}

/**
 * 预估费用（生成前调用，用于显示）
 */
export function estimateCost(model: ModelConfig, params: Record<string, unknown>): CostDetail {
  const result = calculateCost(model, params, undefined)
  result.estimated = true
  return result
}

function centsToYuan(cents: number): number {
  return Math.round(cents * 100) / 10000
}
