/**
 * Canvas 失败原因分类 — 把后端存储的 errorMessage 归类为用户可理解的失败类型
 *
 * 目标（P0-4）：失败不只显示「失败」，还要说明是
 *   provider（模型/服务）/ 网络 / 存储 / 余额 / 内容 / 取消 / 系统
 * 哪一类错误，并给出对应的下一步建议。
 *
 * 分类基于关键词匹配 DashScope 友好中文消息（见 dashscope-errors.ts）
 * 以及原始 provider 错误码。匹配顺序：从具体到宽泛（余额 → 内容 → 网络 → 存储 → 取消 → provider → 系统）。
 */

/** Canvas 任务失败类型 — 对应不同的下一步建议 */
export type CanvasFailureKind
  = | 'balance' // 余额/配额不足
    | 'content' // 内容审核未通过
    | 'network' // 网络超时/连接
    | 'storage' // 存储上传/下载
    | 'cancel' // 用户主动取消
    | 'provider' // 模型/服务端错误（限流、鉴权、不可用等）
    | 'system' // 系统未知错误

/** 失败分类结果 — kind + 中文标签 + 下一步建议 */
export interface CanvasFailureClassification {
  kind: CanvasFailureKind
  /** 简短中文标签，用于徽章展示 */
  label: string
  /** 下一步建议（给用户的可操作指引） */
  suggestion: string
}

const FAILURE_LABELS: Record<CanvasFailureKind, string> = {
  balance: '余额不足',
  content: '内容审核未通过',
  network: '网络异常',
  storage: '存储异常',
  cancel: '已取消',
  provider: '模型/服务异常',
  system: '系统错误',
}

const FAILURE_SUGGESTIONS: Record<CanvasFailureKind, string> = {
  balance: '账号欠费或配额耗尽，请前往阿里云控制台充值/提升配额后重试。',
  content: '输入或生成内容未通过审核，请修改故事文本或提示词中可能敏感的部分后重试。',
  network: '请求超时或网络中断，请检查网络连接后重试；若持续超时可尝试简化输入。',
  storage: '结果文件上传/下载失败，请检查 OSS/本地存储配置后重试。',
  cancel: '该任务已被取消，如需继续可重新执行该阶段。',
  provider: '模型服务暂时异常或被限流，请稍后重试；如多次失败请检查模型是否已开通。',
  system: '发生未知系统错误，请稍后重试；如持续出现请联系管理员查看日志。',
}

/** 关键词规则表 — 按匹配优先级排序（具体在前，宽泛在后） */
const RULES: Array<{ kind: CanvasFailureKind, keywords: string[] }> = [
  {
    kind: 'balance',
    keywords: [
      '欠费',
      '充值',
      '配额不足',
      '免费额度已耗尽',
      '配额耗尽',
      'Arrearage',
      'AllocationQuota',
      'insufficient_quota',
      '额度',
    ],
  },
  {
    kind: 'content',
    keywords: [
      '不合规',
      '敏感信息',
      '侵权',
      '审核',
      '审核未通过',
      '策略拦截',
      'DataInspection',
      'IPInfringement',
      'Blocked',
      '内容未通过',
    ],
  },
  {
    kind: 'network',
    keywords: [
      '超时',
      'timeout',
      '网络',
      '拒绝连接',
      'ConnectionRefused',
      'RequestTimeOut',
      'ResponseTimeout',
      'InvalidURL',
      '无法访问',
    ],
  },
  {
    kind: 'storage',
    keywords: [
      '存储',
      '上传失败',
      '下载失败',
      'FileUpload',
      'InternalError.Upload',
      'download',
      'OSS',
      '文件上传',
      '文件下载',
    ],
  },
  {
    kind: 'cancel',
    keywords: ['用户取消', '已取消', 'cancelled', '手动取消', '任务已取消'],
  },
  {
    kind: 'provider',
    keywords: [
      '限流',
      'Throttling',
      '无权限',
      'AccessDenied',
      'ApiKey',
      'API Key 无效',
      '模型不存在',
      '模型已下线',
      '不可用',
      'InternalError',
      '内部错误',
      '推理异常',
      '模型暂时',
      '未开通',
      '不支持的模型',
      'model_not_found',
    ],
  },
]

/**
 * 把失败错误信息分类为用户可理解的失败类型 + 下一步建议
 *
 * @param errorMessage 后端存储的错误信息（中文友好消息或原始错误码/文本）
 * @param status 可选：资产/记录状态，cancelled 直接归类为 cancel
 */
export function classifyCanvasFailure(
  errorMessage: string | null | undefined,
  status?: string,
): CanvasFailureClassification {
  // 状态优先：cancelled 直接归类
  if (status === 'cancelled')
    return build('cancel')

  const text = (errorMessage ?? '').toLowerCase()
  if (!text)
    return build('system')

  for (const rule of RULES) {
    if (rule.keywords.some(kw => text.includes(kw.toLowerCase())))
      return build(rule.kind)
  }

  // 兜底：有错误信息但无法识别 → 系统/未知
  return build('system')
}

function build(kind: CanvasFailureKind): CanvasFailureClassification {
  return { kind, label: FAILURE_LABELS[kind], suggestion: FAILURE_SUGGESTIONS[kind] }
}
