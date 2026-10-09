'use server'

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dataSources } from '@/lib/db/schema'
import { requireUserId, requireWorkspace } from '@/lib/auth/session'
import { decryptCredentials } from '@/lib/security/credentials'
import { KEEP } from '@/lib/connectors/secret-mask'
import {
  buildSalesforceAuthorizeUrl,
  parseSalesforceLoginHost,
  signOAuthState,
} from '@/lib/connectors/salesforce/oauth'

const startInput = z.object({
  clientId: z.string().trim().min(1, 'Consumer Key is required').max(500),
  clientSecret: z.string().trim().min(1, 'Consumer Secret is required').max(500),
  loginHost: z.string().trim().max(200).optional(),
  /** Editing an existing source: a masked secret is read from it. */
  sourceId: z.string().trim().min(1).max(100).optional(),
})

export async function startSalesforceWebAuth(input: {
  clientId: string
  clientSecret: string
  loginHost?: string
  sourceId?: string
}) {
  const userId = await requireUserId()
  const parsed = startInput.parse(input)
  const { clientId, loginHost: rawHost } = parsed
  let clientSecret = parsed.clientSecret
  if (clientSecret === KEEP && parsed.sourceId) {
    const ctx = await requireWorkspace('sources:manage')
    const [source] = await db
      .select({ id: dataSources.id, credentials: dataSources.credentials })
      .from(dataSources)
      .where(and(eq(dataSources.id, parsed.sourceId), eq(dataSources.workspaceId, ctx.workspaceId)))
      .limit(1)
    if (!source) throw new Error('Data source not found')
    clientSecret = String(decryptCredentials(source.id, source.credentials).clientSecret ?? '')
    if (!clientSecret) throw new Error('Enter the Consumer Secret.')
  }
  const loginHost = parseSalesforceLoginHost(rawHost)

  const nonce = randomUUID()
  const exp = Date.now() + 10 * 60 * 1000
  const signed = signOAuthState({
    userId,
    nonce,
    exp,
    clientId,
    clientSecret,
    loginHost,
  })

  const cookieStore = await cookies()
  cookieStore.set('sf_oauth_pending', signed, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  })

  const authorizeUrl = buildSalesforceAuthorizeUrl({ clientId, loginHost, state: nonce })
  return { authorizeUrl }
}
