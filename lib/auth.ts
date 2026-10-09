import { randomUUID } from 'node:crypto'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { pool } from '@/lib/db'
import { emailEnabled, sendEmail } from '@/lib/email'

export const APP_NAME = 'KMPlus Nexus'

/**
 * Sign-in sequence (TD-2):
 *   sign-up → verification email → link signs the user in → /setup-2fa (scan a
 *   QR code with any authenticator app) → dashboard.
 *   sign-in → password → /verify-2fa (6-digit code or a backup code) → dashboard.
 * 2FA is mandatory: requireSession() in lib/auth/session.ts rejects accounts
 * without it, and the dashboard redirects them to /setup-2fa.
 */

const LOGIN_PATHS = new Set(['/sign-in/email', '/two-factor/verify-totp', '/two-factor/verify-backup-code', '/verify-email'])
/** Self-service security changes (Settings → Your account security). */
const SECURITY_PATHS: Record<string, string> = {
  '/two-factor/generate-backup-codes': 'REGENERATE_BACKUP_CODES',
  '/two-factor/disable': 'DISABLE_2FA',
}

/**
 * Records LOGIN, ENABLE_2FA and self-service 2FA changes in audit_logs.
 * Registered after twoFactor, so a password step that still needs a code has
 * no session here and isn't logged. Writes with the pool directly: lib/audit
 * imports lib/auth, which would be a cycle.
 */
const auditLogins = () =>
  ({
    id: 'nexus-audit-logins',
    hooks: {
      after: [
        {
          matcher: (ctx) => LOGIN_PATHS.has(ctx.path ?? '') || (ctx.path ?? '') in SECURITY_PATHS,
          handler: createAuthMiddleware(async (ctx) => {
            const path = ctx.path ?? ''
            const created = ctx.context.newSession
            let entry: { userId: string; action: string; changes: object; ip?: string | null; ua?: string | null } | null = null
            if (path in SECURITY_PATHS) {
              // Only after success: a wrong password throws before this hook.
              const actor = created ?? ctx.context.session
              if (actor) entry = { userId: actor.user.id, action: SECURITY_PATHS[path], changes: {}, ip: actor.session.ipAddress, ua: actor.session.userAgent }
            } else if (created) {
              const challenge = ctx.headers?.get('cookie')?.includes('.two_factor=') ?? false
              const enabling = path === '/two-factor/verify-totp' && !challenge
              const method = path === '/sign-in/email' ? 'password' : path === '/verify-email' ? 'email_link' : path.endsWith('backup-code') ? 'backup_code' : 'totp'
              entry = { userId: created.user.id, action: enabling ? 'ENABLE_2FA' : 'LOGIN', changes: enabling ? {} : { method }, ip: created.session.ipAddress, ua: created.session.userAgent }
            }
            if (!entry) return
            try {
              await pool.query(
                'insert into audit_logs ("id", "userId", "workspaceId", "action", "resource", "resourceId", "changes", "ipAddress", "userAgent") values ($1, $2, null, $3, $4, $2, $5, $6, $7)',
                [`audit_${randomUUID()}`, entry.userId, entry.action, 'account', JSON.stringify(entry.changes), entry.ip ?? null, entry.ua?.slice(0, 300) ?? null]
              )
            } catch (err) {
              console.error('[auth] audit insert failed:', err instanceof Error ? err.message : err)
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin

export const auth = betterAuth({
  appName: APP_NAME,
  secret: process.env.BETTER_AUTH_SECRET,
  database: pool,
  baseURL:
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : process.env.V0_RUNTIME_URL),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    // Off only in production without SMTP, where the email could never arrive.
    requireEmailVerification: emailEnabled(),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, url }) => {
      try {
        await sendEmail({
          to: user.email,
          subject: 'Verify your email for KMPlus Nexus',
          lines: [
            `Hi ${user.name || user.email},`,
            'Confirm this is your email address to finish creating your KMPlus Nexus account. The link works for 24 hours.',
            'Next you will set up two-factor authentication with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy, …).',
            "If you didn't sign up, ignore this email.",
          ],
          action: { label: 'Verify email', url },
        })
      } catch (err) {
        console.error('[auth] verification email failed:', err instanceof Error ? err.message : err)
        throw err
      }
    },
  },
  plugins: [
    twoFactor({
      issuer: APP_NAME,
      backupCodeOptions: { amount: 10, length: 10 },
    }),
    auditLogins(),
  ],
  trustedOrigins: [
    ...(process.env.V0_RUNTIME_URL ? [process.env.V0_RUNTIME_URL] : []),
    ...(process.env.VERCEL_URL ? [`https://${process.env.VERCEL_URL}`] : []),
    ...(process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? [`https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`]
      : []),
    'http://localhost:3000',
    'http://localhost:3001',
    'https://vm-rafjbtamt3i.vusercontent.net',
  ],
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // 1 day
  },
  ...(process.env.NODE_ENV === 'development'
    ? {
        advanced: {
          // In dev (v0 preview iframe), force cross-site cookies so the
          // session cookie is stored by the browser.
          defaultCookieAttributes: {
            sameSite: 'none' as const,
            secure: true,
          },
        },
      }
    : {}),
})
