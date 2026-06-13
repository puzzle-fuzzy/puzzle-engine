import type { RateLimitErrorResponse } from '@excuse/shared'

export interface RateLimitDecision {
  allowed: boolean
  retryAfterSec: number
}

export interface CategoryRateLimitOptions {
  userId: string
  category: string
  maxRequests: number
  windowMs: number
  now?: number
}

interface WindowEntry {
  timestamps: number[]
}

export const DEFAULT_GLOBAL_RATE_LIMIT = {
  durationMs: 60 * 1000,
  max: 60,
  retryAfterSec: 60,
  message: '请求过于频繁，请稍后再试',
} as const

export function buildRateLimitKey(request: Request): string {
  const authHeader = request.headers.get('authorization')
  if (authHeader)
    return `user:${authHeader.slice(0, 50)}`
  return `ip:${request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'}`
}

export function createRateLimitErrorBody(
  retryAfterSec = DEFAULT_GLOBAL_RATE_LIMIT.retryAfterSec,
  message = DEFAULT_GLOBAL_RATE_LIMIT.message,
): RateLimitErrorResponse {
  return {
    success: false,
    error: message,
    retryAfter: retryAfterSec,
  }
}

export function createRateLimitErrorResponse(
  retryAfterSec = DEFAULT_GLOBAL_RATE_LIMIT.retryAfterSec,
  message = DEFAULT_GLOBAL_RATE_LIMIT.message,
): Response {
  return new Response(JSON.stringify(createRateLimitErrorBody(retryAfterSec, message)), {
    status: 429,
    headers: {
      'Content-Type': 'application/json',
      'Retry-After': String(retryAfterSec),
    },
  })
}

export class SlidingWindowRateLimiter {
  private windows = new Map<string, WindowEntry>()

  check(opts: CategoryRateLimitOptions): RateLimitDecision {
    const { userId, category, maxRequests, windowMs } = opts
    const key = `${userId}:${category}`
    const now = opts.now ?? Date.now()

    this.cleanup(key, now, windowMs)

    const entry = this.windows.get(key)
    if (!entry) {
      this.windows.set(key, { timestamps: [now] })
      return { allowed: true, retryAfterSec: 0 }
    }

    if (entry.timestamps.length >= maxRequests) {
      const oldest = entry.timestamps[0]!
      const retryAfterMs = oldest + windowMs - now
      return { allowed: false, retryAfterSec: Math.ceil(retryAfterMs / 1000) }
    }

    entry.timestamps.push(now)
    return { allowed: true, retryAfterSec: 0 }
  }

  reset(): void {
    this.windows.clear()
  }

  private cleanup(key: string, now: number, windowMs: number): void {
    const entry = this.windows.get(key)
    if (!entry)
      return
    entry.timestamps = entry.timestamps.filter(timestamp => now - timestamp < windowMs)
    if (entry.timestamps.length === 0)
      this.windows.delete(key)
  }
}
