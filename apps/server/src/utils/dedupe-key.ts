interface DedupeKeyInput {
  accountId: string
  model: string
  parameters: unknown
  referenceFileIds?: readonly string[]
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(item => item === undefined ? null : canonicalize(item))
  }

  if (!isPlainObject(value)) {
    return value
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  )
}

function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

async function sha256Hex(value: string): Promise<string> {
  const encoded = new TextEncoder().encode(value)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * 生成稳定去重键。
 *
 * 约束：
 * - 对象 key 顺序不影响结果。
 * - 已校验参数参与 hash，显式默认值和模型默认值合并后语义一致。
 * - referenceFileIds 参与 hash，避免同 prompt 但不同参考文件被误判重复。
 */
export async function createDedupeKey(input: DedupeKeyInput): Promise<string> {
  const canonicalPayload = canonicalStringify({
    accountId: input.accountId,
    model: input.model,
    parameters: input.parameters,
    referenceFileIds: input.referenceFileIds,
  })

  return `sha256:${await sha256Hex(canonicalPayload)}`
}

export const __test = {
  canonicalStringify,
}
