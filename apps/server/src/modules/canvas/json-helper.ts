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
  const patterns = firstChar === '['
    ? [/\[[\s\S]*\]/, /\{[\s\S]*\}/]
    : [/\{[\s\S]*\}/, /\[[\s\S]*\]/]

  for (const pattern of patterns) {
    const match = cleaned.match(pattern)
    if (match) {
      try {
        return JSON.parse(match[0]) as T
      }
      catch {
        continue
      }
    }
  }

  throw new Error(`Failed to extract JSON from LLM output: ${raw.slice(0, 200)}`)
}
