'use server'

import { randomBytes, randomUUID } from 'node:crypto'
import { resolveTxt } from 'node:dns/promises'
import { z } from 'zod'
import { and, eq, ne } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { ssoProvider, workspaceSso } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { ROLES } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { DOMAIN_RE, PUBLIC_EMAIL_DOMAINS, SSO_PRESETS, issuerFor } from '@/lib/auth/sso-presets'
import { safeFetch, UnsafeUrlError } from '@/lib/net/safe-url'
import { guard } from '@/lib/server-action'

/**
 * Workspace SSO providers (GV-8): admins register an OpenID Connect app of
 * their identity provider, prove the email domain with a DNS TXT record, and
 * choose the role new SSO users get. The Better Auth SSO plugin performs the
 * sign-in; its own provider-management endpoints are disabled (lib/auth.ts).
 */

const TXT_PREFIX = '_nexus-sso'
const txtValue = (token: string) => `nexus-sso-verification=${token}`

async function baseUrl() {
  const configured = process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  if (configured) return configured.replace(/\/+$/, '')
  const h = await headers()
  return `${h.get('x-forwarded-proto') ?? 'http'}://${h.get('host')}`
}

async function owned(ctx: WorkspaceContext, providerId: string) {
  const [row] = await db.select().from(workspaceSso).where(and(eq(workspaceSso.workspaceId, ctx.workspaceId), eq(workspaceSso.providerId, providerId))).limit(1)
  if (!row) throw new Error('SSO provider not found')
  return row
}

async function listSsoProvidersImpl() {
  const ctx = await requireWorkspace('workspace:manage')
  const rows = await db
    .select({ w: workspaceSso, verified: ssoProvider.domainVerified, issuer: ssoProvider.issuer })
    .from(workspaceSso)
    .innerJoin(ssoProvider, eq(ssoProvider.providerId, workspaceSso.providerId))
    .where(eq(workspaceSso.workspaceId, ctx.workspaceId))
  const base = await baseUrl()
  return rows.map(({ w, verified, issuer }) => ({
    providerId: w.providerId,
    label: w.label,
    preset: w.preset,
    domain: w.domain,
    issuer,
    defaultRole: w.defaultRole,
    enforce: w.enforce,
    verified: Boolean(verified),
    verifiedAt: w.verifiedAt,
    dnsRecord: { name: `${TXT_PREFIX}.${w.domain}`, type: 'TXT', value: txtValue(w.verificationToken) },
    redirectUri: `${base}/api/auth/sso/callback/${w.providerId}`,
    createdAt: w.createdAt,
  }))
}

const createInput = z.object({
  label: z.string().trim().min(1).max(80),
  preset: z.enum(SSO_PRESETS),
  /** Tenant ID (Azure), Okta domain, or issuer URL (other); ignored for Google. */
  issuerValue: z.string().trim().max(300).default(''),
  domain: z.string().trim().toLowerCase().regex(DOMAIN_RE, 'Enter your email domain, e.g. kmplus.co.id'),
  clientId: z.string().trim().min(1, 'Client ID is required').max(300),
  clientSecret: z.string().trim().min(1, 'Client secret is required').max(1000),
  defaultRole: z.enum(ROLES).default('viewer'),
})

/** Reads the issuer's OpenID configuration (https, public hosts only) and checks it matches. */
async function discover(issuer: string) {
  const discoveryEndpoint = `${issuer.replace(/\/+$/, '')}/.well-known/openid-configuration`
  let doc: Record<string, unknown>
  try {
    const res = await safeFetch(discoveryEndpoint, { timeoutMs: 8000, headers: { accept: 'application/json' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    doc = (await res.json()) as Record<string, unknown>
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new Error(err.message)
    throw new Error(`Could not read ${discoveryEndpoint} (${err instanceof Error ? err.message : 'failed'}). Check the tenant/domain/issuer.`)
  }
  const str = (k: string) => (typeof doc[k] === 'string' ? (doc[k] as string) : undefined)
  // Azure's multi-tenant documents use a {tenantid} placeholder; single-tenant issuers must match exactly.
  if (str('issuer') && str('issuer')!.replace(/\/+$/, '') !== issuer.replace(/\/+$/, '') && !str('issuer')!.includes('{tenantid}')) {
    throw new Error(`The provider reports issuer ${str('issuer')}, not ${issuer}.`)
  }
  for (const k of ['authorization_endpoint', 'token_endpoint', 'jwks_uri']) if (!str(k)?.startsWith('https://')) throw new Error(`The provider's configuration has no https ${k}.`)
  return { discoveryEndpoint, authorizationEndpoint: str('authorization_endpoint')!, tokenEndpoint: str('token_endpoint')!, jwksEndpoint: str('jwks_uri')!, userInfoEndpoint: str('userinfo_endpoint') }
}

async function createSsoProviderImpl(input: z.input<typeof createInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = createInput.parse(input)
  if (PUBLIC_EMAIL_DOMAINS.has(data.domain)) throw new Error(`${data.domain} is a public email provider; SSO needs your organization's own domain.`)
  if (data.preset !== 'google' && !data.issuerValue) throw new Error('Fill in the tenant ID, Okta domain or issuer URL.')
  const issuer = issuerFor(data.preset, data.issuerValue)
  const endpoints = await discover(issuer)
  const providerId = `sso-${randomUUID().slice(0, 12)}`
  const token = randomBytes(18).toString('base64url')
  const oidcConfig = {
    issuer,
    pkce: true,
    clientId: data.clientId,
    clientSecret: data.clientSecret,
    scopes: ['openid', 'email', 'profile'],
    tokenEndpointAuthentication: 'client_secret_post' as const,
    ...endpoints,
    mapping: { id: 'sub', email: 'email', emailVerified: 'email_verified', name: 'name', image: 'picture' },
  }
  await db.transaction(async (tx) => {
    await tx.insert(ssoProvider).values({ id: newId('ssop'), issuer, oidcConfig: JSON.stringify(oidcConfig), userId: ctx.userId, providerId, domain: data.domain, domainVerified: false })
    await tx.insert(workspaceSso).values({ id: newId('wsso'), workspaceId: ctx.workspaceId, providerId, label: data.label, preset: data.preset, domain: data.domain, defaultRole: data.defaultRole, verificationToken: token, createdBy: ctx.userId })
  })
  await recordAudit(ctx, { action: 'CREATE', resource: 'sso_provider', resourceId: providerId, changes: { label: data.label, preset: data.preset, domain: data.domain, issuer, defaultRole: data.defaultRole } })
  revalidatePath('/dashboard')
  return { providerId }
}

/** Checks the DNS TXT record and turns sign-in on for the domain. */
async function verifySsoDomainImpl(rawProviderId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const row = await owned(ctx, z.string().min(1).max(60).parse(rawProviderId))
  const name = `${TXT_PREFIX}.${row.domain}`
  const records = await resolveTxt(name).catch(() => [] as string[][])
  if (!records.some((parts) => parts.join('') === txtValue(row.verificationToken))) {
    throw new Error(`TXT record not found yet at ${name}. DNS changes can take a few minutes; try again shortly.`)
  }
  const taken = await db
    .select({ providerId: ssoProvider.providerId })
    .from(ssoProvider)
    .where(and(eq(ssoProvider.domain, row.domain), eq(ssoProvider.domainVerified, true), ne(ssoProvider.providerId, row.providerId)))
    .limit(1)
  if (taken.length) throw new Error(`${row.domain} is already verified by another SSO provider. A domain can sign in to one workspace.`)
  await db.update(ssoProvider).set({ domainVerified: true }).where(eq(ssoProvider.providerId, row.providerId))
  await db.update(workspaceSso).set({ verifiedAt: new Date(), updatedAt: new Date() }).where(eq(workspaceSso.id, row.id))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'sso_provider', resourceId: row.providerId, changes: { domainVerified: row.domain } })
  revalidatePath('/dashboard')
}

const updateInput = z.object({
  providerId: z.string().min(1).max(60),
  defaultRole: z.enum(ROLES).optional(),
  enforce: z.boolean().optional(),
  /** New client secret (rotation); omitted = keep. */
  clientSecret: z.string().trim().min(1).max(1000).optional(),
})

async function updateSsoProviderImpl(input: z.input<typeof updateInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = updateInput.parse(input)
  const row = await owned(ctx, data.providerId)
  if (data.enforce) {
    const [p] = await db.select({ verified: ssoProvider.domainVerified }).from(ssoProvider).where(eq(ssoProvider.providerId, row.providerId)).limit(1)
    if (!p?.verified) throw new Error('Verify the domain before requiring SSO.')
  }
  await db
    .update(workspaceSso)
    .set({ ...(data.defaultRole ? { defaultRole: data.defaultRole } : {}), ...(data.enforce !== undefined ? { enforce: data.enforce } : {}), updatedAt: new Date() })
    .where(eq(workspaceSso.id, row.id))
  if (data.clientSecret) {
    const [p] = await db.select({ oidcConfig: ssoProvider.oidcConfig }).from(ssoProvider).where(eq(ssoProvider.providerId, row.providerId)).limit(1)
    const cfg = JSON.parse(p.oidcConfig ?? '{}') as Record<string, unknown>
    await db.update(ssoProvider).set({ oidcConfig: JSON.stringify({ ...cfg, clientSecret: data.clientSecret }) }).where(eq(ssoProvider.providerId, row.providerId))
  }
  // Field names only: never the secret.
  await recordAudit(ctx, { action: 'UPDATE', resource: 'sso_provider', resourceId: row.providerId, changes: { defaultRole: data.defaultRole, enforce: data.enforce, rotatedSecret: Boolean(data.clientSecret) } })
  revalidatePath('/dashboard')
}

async function deleteSsoProviderImpl(rawProviderId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const row = await owned(ctx, z.string().min(1).max(60).parse(rawProviderId))
  await db.delete(ssoProvider).where(eq(ssoProvider.providerId, row.providerId))
  await db.delete(workspaceSso).where(eq(workspaceSso.id, row.id))
  await recordAudit(ctx, { action: 'DELETE', resource: 'sso_provider', resourceId: row.providerId, changes: { domain: row.domain } })
  revalidatePath('/dashboard')
}

export async function listSsoProviders(...args: Parameters<typeof listSsoProvidersImpl>) {
  return guard(() => listSsoProvidersImpl(...args))
}

export async function createSsoProvider(...args: Parameters<typeof createSsoProviderImpl>) {
  return guard(() => createSsoProviderImpl(...args))
}

export async function verifySsoDomain(...args: Parameters<typeof verifySsoDomainImpl>) {
  return guard(() => verifySsoDomainImpl(...args))
}

export async function updateSsoProvider(...args: Parameters<typeof updateSsoProviderImpl>) {
  return guard(() => updateSsoProviderImpl(...args))
}

export async function deleteSsoProvider(...args: Parameters<typeof deleteSsoProviderImpl>) {
  return guard(() => deleteSsoProviderImpl(...args))
}
