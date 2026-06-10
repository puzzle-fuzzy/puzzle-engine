import type { ModelConfig } from '@excuse/shared'

/**
 * 计算单次生成的费用
 *
 * - 文本：按输入/输出 token 数 × 每百万 token 价格
 * - 图片：按张数 × 单价
 * - 视频：按时长（秒）× 单价（按分辨率）
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
): Record<string, unknown> {
  const pricing = model.pricing

  switch (pricing.unit) {
    case 'token': {
      // 文本生成
      const inputTokens = usage?.inputTokens || 0
      const outputTokens = usage?.outputTokens || 0
      const inputCost = (inputTokens / 1_000_000) * (pricing.inputPrice || 0)
      const outputCost = (outputTokens / 1_000_000) * (pricing.outputPrice || 0)
      const total = roundTo4(inputCost + outputCost)

      return {
        unit: 'token',
        inputTokens,
        outputTokens,
        inputUnitPrice: pricing.inputPrice,
        outputUnitPrice: pricing.outputPrice,
        inputCost: roundTo4(inputCost),
        outputCost: roundTo4(outputCost),
        totalPrice: total,
      }
    }

    case 'image': {
      // 图片生成
      const count = usage?.imageCount || (params.n as number) || 1
      const unitPrice = pricing.inputPrice
      const total = roundTo4(count * unitPrice)

      return {
        unit: 'image',
        quantity: count,
        unitPrice,
        totalPrice: total,
      }
    }

    case 'video': {
      // 视频生成
      const duration = usage?.videoDuration || (params.duration as number) || 5
      const resolution = (params.resolution as string) || '720P'
      const unitPrice = resolution === '1080P' ? (pricing.inputPrice1080 || pricing.inputPrice) : pricing.inputPrice
      const total = roundTo4(duration * unitPrice)

      return {
        unit: 'video',
        duration,
        resolution,
        unitPrice,
        totalPrice: total,
      }
    }

    default:
      return { unit: 'unknown', totalPrice: 0 }
  }
}

/**
 * 预估费用（生成前调用，用于显示）
 */
export function estimateCost(model: ModelConfig, params: Record<string, unknown>): Record<string, unknown> {
  return calculateCost(model, params, undefined)
}

function roundTo4(n: number): number {
  return Math.round(n * 10000) / 10000
}
