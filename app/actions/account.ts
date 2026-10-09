'use server'

import { headers } from 'next/headers'
import { auth } from '@/lib/auth'
import { requireUserId } from '@/lib/auth/session'
import { guard } from '@/lib/server-action'

/** The signed-in user's 2FA state for Settings → Your account security. Codes themselves are never returned. */
async function getAccountSecurityImpl() {
  const userId = await requireUserId()
  const session = await auth.api.getSession({ headers: await headers() })
  let backupCodesLeft: number | null = null
  try {
    const res = await auth.api.viewBackupCodes({ body: { userId } })
    backupCodesLeft = res.backupCodes.length
  } catch {
    backupCodesLeft = null
  }
  return { email: session?.user.email ?? '', twoFactorEnabled: Boolean(session?.user.twoFactorEnabled), backupCodesLeft }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/account.ts. ──

export async function getAccountSecurity(...args: Parameters<typeof getAccountSecurityImpl>) {
  return guard(() => getAccountSecurityImpl(...args))
}
