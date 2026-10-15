/**
 * Terms and Conditions acceptances (server only). The current version is
 * TERMS_VERSION (lib/legal/terms.ts); requirePageUser sends people who haven't
 * accepted it to /accept-terms, and requireSession refuses their actions.
 */
import { randomUUID } from 'node:crypto'
import { cache } from 'react'
import { pool } from '@/lib/db'
import { TERMS_VERSION } from './terms'

export interface TermsAcceptance {
  version: string
  acceptedAt: string
}

/** The user's most recent acceptance, any version (once per request). */
export const latestTermsAcceptance = cache(async (userId: string): Promise<TermsAcceptance | null> => {
  const { rows } = await pool.query<{ version: string; acceptedAt: Date }>(
    'select "version", "acceptedAt" from terms_acceptances where "userId" = $1 order by "acceptedAt" desc limit 1',
    [userId],
  )
  return rows[0] ? { version: rows[0].version, acceptedAt: rows[0].acceptedAt.toISOString() } : null
})

/** Whether the user accepted the current version (once per request). */
export const hasAcceptedCurrentTerms = cache(async (userId: string): Promise<boolean> => {
  const { rows } = await pool.query('select 1 from terms_acceptances where "userId" = $1 and "version" = $2 limit 1', [userId, TERMS_VERSION])
  return rows.length > 0
})

/**
 * Records an acceptance of the current version. Only for a user that exists
 * (sign-up returns a stand-in user for an email already registered); a second
 * acceptance of the same version is ignored.
 */
export async function recordTermsAcceptance(input: { userId: string; method: 'sign_up' | 'prompt'; locale?: string | null; ipAddress?: string | null; userAgent?: string | null }) {
  await pool.query(
    `insert into terms_acceptances ("id", "userId", "version", "method", "locale", "ipAddress", "userAgent")
     select $1, $2, $3, $4, $5, $6, $7 where exists (select 1 from "user" where "id" = $2)
     on conflict ("userId", "version") do nothing`,
    [`terms_${randomUUID()}`, input.userId, TERMS_VERSION, input.method, input.locale ?? null, input.ipAddress ?? null, input.userAgent?.slice(0, 300) ?? null],
  )
}

/** The caller's IP address from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(headers: Headers | null | undefined): string | null {
  const forwarded = headers?.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || headers?.get('x-real-ip') || null
}
