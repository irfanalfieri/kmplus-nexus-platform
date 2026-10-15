'use server'

import { headers } from 'next/headers'
import { z } from 'zod'
import { auth } from '@/lib/auth'
import { guard } from '@/lib/server-action'
import { TERMS_VERSION } from '@/lib/legal/terms'
import { clientIp, recordTermsAcceptance } from '@/lib/legal/acceptance'
import { getLocale } from '@/lib/i18n/server'

/**
 * Accepts the current Terms and Conditions (the /accept-terms screen). Needs a
 * session but not 2FA or a previous acceptance: it is what lets the user in.
 */
async function acceptTermsImpl(rawVersion: string) {
  const version = z.string().max(40).parse(rawVersion)
  const h = await headers()
  const session = await auth.api.getSession({ headers: h })
  if (!session?.user) throw new Error('Unauthorized')
  // The page was open while a new version was published: show the new one first.
  if (version !== TERMS_VERSION) throw new Error('The Terms and Conditions were updated while this page was open. Reload the page to read the new version.')
  await recordTermsAcceptance({ userId: session.user.id, method: 'prompt', locale: await getLocale(), ipAddress: clientIp(h), userAgent: h.get('user-agent') })
  return { version }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/legal.ts. ──

export async function acceptTerms(...args: Parameters<typeof acceptTermsImpl>) {
  return guard(() => acceptTermsImpl(...args))
}
