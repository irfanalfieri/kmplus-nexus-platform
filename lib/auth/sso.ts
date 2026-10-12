import { randomUUID } from 'node:crypto'
import { pool } from '@/lib/db'

/**
 * Single sign-on (GV-8) server helpers used by lib/auth.ts. They only use the
 * pool (lib/auth must not import modules that import lib/auth).
 *
 *   Admin registers an OIDC provider (Azure AD / Google / Okta) for a domain
 *   → proves the domain with a DNS TXT record → users of that domain choose
 *   "Sign in with SSO", the plugin signs them in, and they join the workspace
 *   with the provider's default role. The IdP enforces MFA, so SSO sessions
 *   skip Nexus TOTP; password sign-ins still need it.
 */

export const emailDomain = (email: string) => email.trim().toLowerCase().split('@')[1] ?? ''

/** The verified provider that requires SSO for this email's domain, if any. */
export async function enforcedProviderFor(email: string): Promise<string | null> {
  const domain = emailDomain(email)
  if (!domain) return null
  const { rows } = await pool.query<{ label: string }>(
    `SELECT w.label FROM workspace_sso w JOIN "ssoProvider" p ON p."providerId" = w."providerId"
      WHERE w.domain = $1 AND w.enforce AND p."domainVerified" LIMIT 1`,
    [domain]
  )
  return rows[0]?.label ?? null
}

/** SSO may only create users whose email is at the provider's verified domain. */
export async function emailAllowedForProvider(providerId: string, email: string): Promise<boolean> {
  const { rows } = await pool.query<{ domain: string; domainVerified: boolean | null }>(`SELECT domain, "domainVerified" FROM "ssoProvider" WHERE "providerId" = $1`, [providerId])
  const p = rows[0]
  return Boolean(p?.domainVerified) && emailDomain(email) === p!.domain.toLowerCase()
}

/** Adds the user to the provider's workspace (default role) if they aren't a member yet; marks the email verified. */
export async function provisionSsoUser(providerId: string, user: { id: string; email: string }) {
  const { rows } = await pool.query<{ workspaceId: string; defaultRole: string; domain: string; jitProvisioning: boolean }>(
    `SELECT w."workspaceId", w."defaultRole", w.domain, w."jitProvisioning" FROM workspace_sso w JOIN "ssoProvider" p ON p."providerId" = w."providerId"
      WHERE w."providerId" = $1 AND p."domainVerified"`,
    [providerId]
  )
  const link = rows[0]
  if (!link || emailDomain(user.email) !== link.domain) return
  // SCIM: someone the IdP deactivated stays out; with JIT off, only SCIM-provisioned users join.
  const scim = await pool.query<{ active: boolean }>('SELECT active FROM scim_users WHERE "workspaceId" = $1 AND "userId" = $2', [link.workspaceId, user.id])
  if (scim.rows[0] && !scim.rows[0].active) return
  if (!link.jitProvisioning && !scim.rows[0]) return
  await pool.query(
    `INSERT INTO workspace_members ("workspaceId", "userId", role) VALUES ($1, $2, $3) ON CONFLICT ("workspaceId", "userId") DO NOTHING`,
    [link.workspaceId, user.id, link.defaultRole]
  )
  // The domain is proven via DNS, so the IdP's address is the user's address.
  await pool.query(`UPDATE "user" SET "emailVerified" = true WHERE id = $1 AND NOT "emailVerified"`, [user.id])
}

/** Audit row for an SSO sign-in (same shape as password logins). */
export async function auditSsoLogin(session: { userId: string; ipAddress?: string | null; userAgent?: string | null }, providerId: string) {
  try {
    await pool.query(
      'insert into audit_logs ("id", "userId", "workspaceId", "action", "resource", "resourceId", "changes", "ipAddress", "userAgent") values ($1, $2, null, $3, $4, $2, $5, $6, $7)',
      [`audit_${randomUUID()}`, session.userId, 'LOGIN', 'account', JSON.stringify({ method: 'sso', providerId }), session.ipAddress ?? null, session.userAgent?.slice(0, 300) ?? null]
    )
  } catch (err) {
    console.error('[auth] SSO audit insert failed:', err instanceof Error ? err.message : err)
  }
}
