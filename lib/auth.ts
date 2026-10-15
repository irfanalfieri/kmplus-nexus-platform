import { randomUUID } from 'node:crypto'
import { betterAuth, type BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { twoFactor } from 'better-auth/plugins'
import { sso } from '@better-auth/sso'
import { Kysely, PostgresDialect } from 'kysely'
import { auditSsoLogin, emailAllowedForProvider, enforcedProviderFor, provisionSsoUser } from '@/lib/auth/sso'
import { SsoConfigPlugin } from '@/lib/auth/sso-config-plugin'
import { pool } from '@/lib/db'
import { TERMS_VERSION } from '@/lib/legal/terms'
import { clientIp, recordTermsAcceptance } from '@/lib/legal/acceptance'
import { emailEnabled, sendEmail } from '@/lib/email'
import { requestLocale, verifyEmail } from '@/lib/email-templates'

export const APP_NAME = 'KMPlus Nexus'

/**
 * Sign-in sequence (TD-2):
 *   sign-up → verification email → link signs the user in → /setup-2fa (scan a
 *   QR code with any authenticator app) → dashboard.
 *   sign-in → password → /verify-2fa (6-digit code or a backup code) → dashboard.
 * 2FA is mandatory: requireSession() in lib/auth/session.ts rejects accounts
 * without it, and the dashboard redirects them to /setup-2fa.
 *   SSO (GV-8): "Sign in with SSO" → the workspace's identity provider → back
 *   signed in (session.authMethod = "sso"; the IdP enforces MFA, so no TOTP).
 */

/** Plugin endpoints Nexus doesn't expose: providers are managed by workspace admins in app/actions/sso.ts. */
const SSO_ADMIN_PATHS = ['/sso/register', '/sso/update-provider', '/sso/delete-provider', '/sso/request-domain-verification', '/sso/verify-domain', '/sso/providers', '/sso/get-provider']
const ssoProviderIdOf = (ctx: { path?: string; params?: Record<string, string> } | null) =>
  ctx?.path?.startsWith('/sso/') ? (ctx.params?.providerId ?? null) : null

/** Domains that require SSO can't use passwords (sign-in, sign-up, reset). */
const enforceSso = () =>
  ({
    id: 'nexus-enforce-sso',
    hooks: {
      before: [
        {
          matcher: (ctx) => ['/sign-in/email', '/sign-up/email', '/request-password-reset', '/forget-password'].includes(ctx.path ?? ''),
          handler: createAuthMiddleware(async (ctx) => {
            const email = (ctx.body as { email?: unknown } | undefined)?.email
            if (typeof email !== 'string') return
            const label = await enforcedProviderFor(email)
            if (label) throw new APIError('FORBIDDEN', { message: `Your organization signs in with ${label}. Use "Sign in with SSO".` })
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin

/**
 * The sign-up form sends the Terms and Conditions version the person agreed to
 * (acceptedTerms). Without the current version the account isn't created; with
 * it, the acceptance is recorded for the new user. Accounts made any other way
 * (SSO, SCIM, invites) accept on the /accept-terms screen at first sign-in.
 */
const requireTermsOnSignUp = () =>
  ({
    id: 'nexus-terms-on-sign-up',
    hooks: {
      before: [
        {
          matcher: (ctx) => ctx.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            const accepted = (ctx.body as { acceptedTerms?: unknown } | undefined)?.acceptedTerms
            if (accepted !== TERMS_VERSION) throw new APIError('BAD_REQUEST', { message: 'Accept the Terms and Conditions to create an account.' })
          }),
        },
      ],
      after: [
        {
          matcher: (ctx) => ctx.path === '/sign-up/email',
          handler: createAuthMiddleware(async (ctx) => {
            const userId = (ctx.context.returned as { user?: { id?: unknown } } | undefined)?.user?.id
            if (typeof userId !== 'string') return
            const lang = /(?:^|;\s*)nexus_lang=(\w+)/.exec(ctx.headers?.get('cookie') ?? '')?.[1]
            try {
              await recordTermsAcceptance({ userId, method: 'sign_up', locale: lang === 'id' ? 'id' : 'en', ipAddress: clientIp(ctx.headers), userAgent: ctx.headers?.get('user-agent') })
            } catch (err) {
              // The approval screen asks again at first sign-in if this didn't save.
              console.error('[auth] terms acceptance insert failed:', err instanceof Error ? err.message : err)
            }
          }),
        },
      ],
    },
  }) satisfies BetterAuthPlugin

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
  // The same pool through Kysely, with a plugin that opens sealed SSO secrets on read (TD-25).
  database: { db: new Kysely({ dialect: new PostgresDialect({ pool }), plugins: [new SsoConfigPlugin()] }), type: 'postgres' },
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
        await sendEmail({ to: user.email, ...verifyEmail({ name: user.name || user.email, url, locale: await requestLocale() }) })
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
    sso({
      domainVerification: { enabled: true },
      provisionUserOnEveryLogin: true,
      provisionUser: async ({ user, provider }) => provisionSsoUser(provider.providerId, user),
    }),
    enforceSso(),
    requireTermsOnSignUp(),
  ],
  disabledPaths: SSO_ADMIN_PATHS,
  databaseHooks: {
    user: {
      create: {
        // SSO only creates accounts for emails at the provider's verified domain.
        before: async (user, ctx) => {
          const providerId = ssoProviderIdOf(ctx)
          if (providerId && !(await emailAllowedForProvider(providerId, user.email))) return false
        },
      },
    },
    session: {
      create: {
        before: async (session, ctx) => (ssoProviderIdOf(ctx) ? { data: { ...session, authMethod: 'sso' } } : undefined),
        after: async (session, ctx) => {
          const providerId = ssoProviderIdOf(ctx)
          if (providerId) await auditSsoLogin(session, providerId)
        },
      },
    },
  },
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
    additionalFields: {
      authMethod: { type: 'string', required: false, input: false },
    },
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
