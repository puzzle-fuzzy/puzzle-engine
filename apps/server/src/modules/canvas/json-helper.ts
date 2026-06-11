export function parseLLMJson<T>(raw: string): T {
  const cleaned = raw
    .replace(/^```(?:json)?\n?/, '')
    .replace(/\n?```$/, '')
    .trim()

  const jsonMatch = cleaned.match(/\{[\s\S]*\}/) || cleaned.match(/\[[\s\S]*\]/)
  if (!jsonMatch)
    throw new Error(`Failed to extract JSON from LLM output: ${raw.slice(0, 200)}`)

  return JSON.parse(jsonMatch[0]) as T
}
