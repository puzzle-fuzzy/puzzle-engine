/**
 * 从 LLM 输出中解析 JSON
 *
 * 1. 去除 markdown 代码块包裹
 * 2. 尝试直接解析
 * 3. 用非贪婪正则提取第一个完整 JSON 结构
 *
 * 注意：返回值仅通过 `as T` 类型断言，调用方应自行校验关键字段。
 * LLM 输出不可靠，对关键数据建议在调用处做字段校验。
 */
export function parseLLMJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

  // Try parsing the entire cleaned text first (common case: clean JSON output)
  try {
    return JSON.parse(cleaned) as T
  }
  catch {
    // Not clean JSON — try extracting from surrounding text
  }

  // Determine which type to try first based on first significant character
  const firstChar = cleaned.match(/[{[]/)?.[0]
  // 非贪婪匹配：找到第一个匹配的完整 JSON（避免贪婪 [\s\S]* 吞掉多个 JSON 对象）
  const patterns = firstChar === '['
    ? [/\[[\s\S]*?\]/, /\{[\s\S]*?\}/]
    : [/\{[\s\S]*?\}/, /\[[\s\S]*?\]/]

  for (const pattern of patterns) {
    // 用 match + 循环尝试所有匹配位置（非贪婪可能有多个候选）
    const matches = cleaned.match(new RegExp(pattern.source, 'g'))
    if (matches) {
      for (const candidate of matches) {
        try {
          return JSON.parse(candidate) as T
        }
        catch {
          continue
        }
      }
    }
  }

  throw new Error(`Failed to extract JSON from LLM output: ${raw.slice(0, 200)}`)
}
