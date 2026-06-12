// ===== Billing 参数类型 =====

/**
 * 计费参数 — billing 计算所需的已知字段
 *
 * 从 ValidatedModelParameters 或 Record<string, unknown> 提取，
 * billing 包无法导入 provider branded type，故接受 Record 作为输入。
 * typeof guards 保留（防御性编程：JSONB 数据可能被手动编辑）。
 */
export interface BillingParams {
  /** 图片生成数量（image 计费 unit 使用） */
  n?: number
  /** 视频时长秒数（video 计费 unit 使用） */
  duration?: number
  /** 视频分辨率（video 计费 unit 使用，720P/1080P） */
  resolution?: string
}

/**
 * 从生成参数提取 billing 所需字段
 *
 * 兼容 ValidatedModelParameters（branded type extends Record，自动适配）
 * 和 Record<string, unknown>（worker 从 DB 读取的 inputParams）
 */
export function extractBillingParams(params: Record<string, unknown>): BillingParams {
  return {
    n: typeof params.n === 'number' ? params.n : undefined,
    duration: typeof params.duration === 'number' ? params.duration : undefined,
    resolution: typeof params.resolution === 'string' ? params.resolution : undefined,
  }
}
