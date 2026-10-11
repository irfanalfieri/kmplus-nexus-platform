'use client'

import { createAuthClient } from 'better-auth/react'
import { twoFactorClient } from 'better-auth/client/plugins'
import { ssoClient } from '@better-auth/sso/client'

export const authClient = createAuthClient({
  // Pages handle the redirect themselves (AuthForm sends them to /verify-2fa).
  plugins: [twoFactorClient(), ssoClient({ domainVerification: { enabled: true } })],
})

export const { signIn, signUp, signOut, useSession } = authClient
