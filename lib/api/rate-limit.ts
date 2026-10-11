import { pool } from '@/lib/db'

/**
 * Fixed one-minute windows per bucket (API-6), counted in Postgres so every
 * serverless instance shares them. One statement per request.
 */
export interface RateLimitResult {
  allowed: boolean
  limit: number
  remaining: number
  /** Unix seconds when the window resets. */
  resetAt: number
}

export async function consumeRateLimit(bucket: string, limit: number): Promise<RateLimitResult> {
  const { rows } = await pool.query<{ count: number; windowStart: Date }>(
    `INSERT INTO api_rate_limits (bucket, "windowStart", count) VALUES ($1, date_trunc('minute', now()), 1)
     ON CONFLICT (bucket, "windowStart") DO UPDATE SET count = api_rate_limits.count + 1
     RETURNING count, "windowStart"`,
    [bucket]
  )
  const { count, windowStart } = rows[0]
  return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count), resetAt: Math.floor(new Date(windowStart).getTime() / 1000) + 60 }
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(r.resetAt),
    ...(r.allowed ? {} : { 'Retry-After': String(Math.max(1, r.resetAt - Math.floor(Date.now() / 1000))) }),
  }
}

/** Old windows are useless after a minute; the cron tick clears them. */
export async function pruneRateLimits() {
  await pool.query(`DELETE FROM api_rate_limits WHERE "windowStart" < now() - interval '10 minutes'`)
}
