export const API_KEY_PREFIX = 'exc_'
export const API_KEY_PREFIX_LENGTH = 8

export interface CreatedApiKeySecret {
  key: string
  prefix: string
}

/** SHA-256 hash for API Key verification and lookup. */
export async function hashApiKey(key: string): Promise<string> {
  const data = new TextEncoder().encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

export function createApiKeySecret(randomId: string = crypto.randomUUID()): CreatedApiKeySecret {
  const key = `${API_KEY_PREFIX}${randomId.replace(/-/g, '')}`
  return {
    key,
    prefix: extractApiKeyPrefix(key),
  }
}

export function extractApiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_LENGTH)
}

export function isApiKeySecret(value: string): boolean {
  return value.startsWith(API_KEY_PREFIX)
}
