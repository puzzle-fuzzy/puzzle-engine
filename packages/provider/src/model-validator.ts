import type { ModelConfig } from '@excuse/shared'

/**
 * 参数校验错误 — 字段级错误信息，可被前端逐项展示
 */
export interface ParameterValidationError {
  field: string
  message: string
}

/**
 * 参数校验结果
 */
export interface ValidationResult {
  valid: boolean
  errors: ParameterValidationError[]
}

/**
 * 经校验+合并的模型参数 — branded type
 *
 * 只能通过 validateAndMerge() 构造，确保参数已通过模型配置校验
 * 且缺失的可选参数已用 defaultValue 补齐。底层仍为 Record<string, unknown>
 * 因为模型参数随 ModelConfig.parameters 动态变化，无法静态枚举所有字段。
 *
 * brand 符号 __validated 保证编译期流纪律：未经校验的 Record 无法
 * 直接传入 DashScopeClient 公开方法（类型不兼容）。
 */
declare const __validatedBrand: unique symbol
export type ValidatedModelParameters = Record<string, unknown> & { readonly [__validatedBrand]: true }

/**
 * 校验 + 合并 + brand — ValidatedModelParameters 的唯一构造路径
 *
 * 返回可辨识结果：
 *   - ok: true  → params 为 ValidatedModelParameters，可直接传入 DashScopeClient
 *   - ok: false → errors 为字段级校验错误，可被前端逐项展示
 */
export function validateAndMerge(
  modelConfig: ModelConfig,
  parameters: Record<string, unknown>,
): { ok: true, params: ValidatedModelParameters } | { ok: false, errors: ParameterValidationError[] } {
  const result = validateModelParameters(modelConfig, parameters)
  if (!result.valid) {
    return { ok: false, errors: result.errors }
  }
  const merged = mergeWithDefaults(modelConfig, parameters)
  return { ok: true, params: merged as ValidatedModelParameters }
}

/**
 * 校验用户提交的参数是否符合模型配置声明
 *
 * 校验规则：
 *   - required: 必填参数缺失时报错
 *   - type: number→数值范围，select→options 内，boolean→布尔值，text→非空字符串（仅 required 时）
 *   - min/max: 数值参数越界报错
 *   - options: select 参数不在 options 内报错
 *   - 未知参数: 不在 parameters[] 声明中的参数报错
 *   - mediaUpload: 带 mediaUpload 的参数值应为 URL 字符串（仅类型检查，文件归属在 route 层校验）
 *
 * 设计约束：
 *   - 只允许模型配置中声明过的参数进入 provider，防止前端绕过
 *   - 校验失败返回 422 + 字段级错误，可被前端逐项展示
 *   - 生成和 Canvas 视频入口都调用同一校验函数
 */
export function validateModelParameters(
  modelConfig: ModelConfig,
  parameters: Record<string, unknown>,
): ValidationResult {
  const errors: ParameterValidationError[] = []
  const declaredNames = new Set(modelConfig.parameters.map(p => p.name))

  // 1. 未知参数 — 不在模型配置声明中
  for (const key of Object.keys(parameters)) {
    if (!declaredNames.has(key)) {
      errors.push({
        field: key,
        message: `未知参数 "${key}"，模型 ${modelConfig.id} 不支持此参数`,
      })
    }
  }

  // 2. 遍历声明的参数，逐一校验
  for (const spec of modelConfig.parameters) {
    const value = parameters[spec.name]

    // 2a. 必填参数缺失
    if (spec.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: spec.name,
        message: `必填参数 "${spec.name}" 缺失`,
      })
      continue
    }

    // 非必填且未提供 → 跳过校验（使用 defaultValue）
    if (value === undefined || value === null) {
      continue
    }

    // 2b. 类型校验
    switch (spec.type) {
      case 'number': {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 应为数值`,
          })
          break
        }
        if (spec.min !== undefined && value < spec.min) {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 最小值为 ${spec.min}`,
          })
        }
        if (spec.max !== undefined && value > spec.max) {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 最大值为 ${spec.max}`,
          })
        }
        break
      }

      case 'select': {
        if (typeof value !== 'string') {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 应为字符串`,
          })
          break
        }
        if (spec.options) {
          const validValues = spec.options.map(o => String(o.value))
          if (!validValues.includes(value)) {
            errors.push({
              field: spec.name,
              message: `参数 "${spec.name}" 值 "${value}" 不在可选范围 [${validValues.join(', ')}]`,
            })
          }
        }
        break
      }

      case 'boolean': {
        if (typeof value !== 'boolean') {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 应为布尔值`,
          })
        }
        break
      }

      case 'text': {
        if (typeof value !== 'string') {
          errors.push({
            field: spec.name,
            message: `参数 "${spec.name}" 应为字符串`,
          })
          break
        }
        // 必填文本参数不能为空字符串（已在 2a 检查）
        break
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

/**
 * 合并用户参数与默认值，返回最终参数集
 *
 * 校验通过后调用此函数，得到带有 defaultValue 的完整参数集。
 * 不修改用户已提供的值，只补填缺失的可选参数。
 */
export function mergeWithDefaults(
  modelConfig: ModelConfig,
  parameters: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = {}

  for (const spec of modelConfig.parameters) {
    if (parameters[spec.name] !== undefined) {
      merged[spec.name] = parameters[spec.name]
    }
    else if (spec.defaultValue !== undefined) {
      merged[spec.name] = spec.defaultValue
    }
  }

  return merged
}
