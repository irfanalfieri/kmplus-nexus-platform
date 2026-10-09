'use server'

import { randomUUID } from 'crypto'
import { z } from 'zod'
import { cookies } from 'next/headers'
import { requireUserId } from '@/lib/auth/session'
import {
  buildSalesforceAuthorizeUrl,
  parseSalesforceLoginHost,
  signOAuthState,
} from '@/lib/connectors/salesforce/oauth'

const startInput = z.object({
  clientId: z.string().trim().min(1, 'Consumer Key is required').max(500),
  clientSecret: z.string().trim().min(1, 'Consumer Secret is required').max(500),
  loginHost: z.string().trim().max(200).optional(),
})

export async function startSalesforceWebAuth(input: {
  clientId: string
  clientSecret: string
  loginHost?: string
}) {
  const userId = await requireUserId()
  const { clientId, clientSecret, loginHost: rawHost } = startInput.parse(input)
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
