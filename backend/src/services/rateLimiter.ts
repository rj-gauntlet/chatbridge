/**
 * Rate limiter with pluggable backends.
 * Uses in-memory Map by default; switches to Redis when REDIS_URL is set.
 */

export interface RateLimiter {
  /** Returns true if the action should be blocked (rate limit exceeded) */
  isLimited(key: string, limit: number, windowMs: number): Promise<boolean>
}

class InMemoryRateLimiter implements RateLimiter {
  private store = new Map<string, { count: number; resetAt: number }>()

  async isLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
    const now = Date.now()
    const entry = this.store.get(key)
    if (!entry || entry.resetAt < now) {
      this.store.set(key, { count: 1, resetAt: now + windowMs })
      return false
    }
    entry.count++
    return entry.count > limit
  }
}

// Only import ioredis if REDIS_URL is set (avoid crash if not installed)
let RedisRateLimiterClass: (new (url: string) => RateLimiter) | null = null

try {
  if (process.env.REDIS_URL) {
    // Dynamic import to avoid requiring ioredis when not needed
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Redis = require('ioredis')

    RedisRateLimiterClass = class RedisRateLimiter implements RateLimiter {
      private client: InstanceType<typeof Redis>

      constructor(url: string) {
        this.client = new Redis(url, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
          connectTimeout: 5000,
        })
        this.client.connect().catch((err: Error) => {
          console.error('[RateLimiter] Redis connection failed, falling back to in-memory:', err.message)
        })
      }

      async isLimited(key: string, limit: number, windowMs: number): Promise<boolean> {
        try {
          const rKey = `ratelimit:${key}`
          const count = await this.client.incr(rKey)
          if (count === 1) {
            await this.client.pexpire(rKey, windowMs)
          }
          return count > limit
        } catch {
          // Redis failure — fail open (allow the request)
          console.warn('[RateLimiter] Redis error, failing open')
          return false
        }
      }
    } as unknown as new (url: string) => RateLimiter
  }
} catch {
  // ioredis not installed — stay with in-memory
}

/** Create the appropriate rate limiter based on environment */
function createRateLimiter(): RateLimiter {
  if (process.env.REDIS_URL && RedisRateLimiterClass) {
    console.log('[RateLimiter] Using Redis backend')
    return new RedisRateLimiterClass(process.env.REDIS_URL)
  }
  console.log('[RateLimiter] Using in-memory backend')
  return new InMemoryRateLimiter()
}

export const rateLimiter = createRateLimiter()
