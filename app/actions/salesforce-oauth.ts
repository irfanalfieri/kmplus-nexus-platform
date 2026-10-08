'use server'

import { randomUUID } from 'crypto'
import { auth } from '@/lib/auth'
import { cookies, headers } from 'next/headers'
import {
  buildSalesforceAuthorizeUrl,
  parseSalesforceLoginHost,
  signOAuthState,
} from '@/lib/connectors/salesforce/oauth'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

export async function startSalesforceWebAuth(input: {
  clientId: string
  clientSecret: string
  loginHost?: string
}) {
  const userId = await getUserId()
  const clientId = input.clientId?.trim()
  const clientSecret = input.clientSecret?.trim()
  const loginHost = parseSalesforceLoginHost(input.loginHost)

  if (!clientId || !clientSecret) {
    throw new Error('Consumer Key and Consumer Secret are required.')
  }

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
