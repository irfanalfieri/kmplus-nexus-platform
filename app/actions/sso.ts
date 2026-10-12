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
import { openSsoConfig, sealSsoConfig } from '@/lib/security/credentials'
import { SAML_PRESETS, manualIdpSettings, parseIdpMetadata, samlConfigFor, spEndpoints, type IdpSettings, type SamlPreset } from '@/lib/auth/saml'
import { guard } from '@/lib/server-action'

/**
 * Workspace SSO providers (GV-8): admins register an OpenID Connect app or a
 * SAML 2.0 application of their identity provider, prove the email domain with
 * a DNS TXT record, and choose the role new SSO users get. The Better Auth SSO plugin performs the
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
    .select({ w: workspaceSso, verified: ssoProvider.domainVerified, issuer: ssoProvider.issuer, samlConfig: ssoProvider.samlConfig })
    .from(workspaceSso)
    .innerJoin(ssoProvider, eq(ssoProvider.providerId, workspaceSso.providerId))
    .where(eq(workspaceSso.workspaceId, ctx.workspaceId))
  const base = await baseUrl()
  return rows.map(({ w, verified, issuer, samlConfig }) => {
    const saml = w.protocol === 'saml' ? (JSON.parse(samlConfig ?? '{}') as { entryPoint?: string; certificateExpires?: string | null }) : null
    return {
    providerId: w.providerId,
    label: w.label,
    protocol: w.protocol as 'oidc' | 'saml',
    preset: w.preset,
    domain: w.domain,
    issuer,
    defaultRole: w.defaultRole,
    enforce: w.enforce,
    jitProvisioning: w.jitProvisioning,
    saml: saml ? { ...spEndpoints(base, w.providerId), idpConfigured: Boolean(saml.entryPoint), certificateExpires: saml.certificateExpires ?? null } : null,
    verified: Boolean(verified),
    verifiedAt: w.verifiedAt,
    dnsRecord: { name: `${TXT_PREFIX}.${w.domain}`, type: 'TXT', value: txtValue(w.verificationToken) },
    redirectUri: `${base}/api/auth/sso/callback/${w.providerId}`,
    createdAt: w.createdAt,
    }
  })
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
    await tx.insert(ssoProvider).values({ id: newId('ssop'), issuer, oidcConfig: sealSsoConfig(providerId, ctx.workspaceId, oidcConfig), userId: ctx.userId, providerId, domain: data.domain, domainVerified: false })
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
  /** Add users on first sign-in; off = only SCIM-provisioned users get access. */
  jitProvisioning: z.boolean().optional(),
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
    .set({ ...(data.defaultRole ? { defaultRole: data.defaultRole } : {}), ...(data.enforce !== undefined ? { enforce: data.enforce } : {}), ...(data.jitProvisioning !== undefined ? { jitProvisioning: data.jitProvisioning } : {}), updatedAt: new Date() })
    .where(eq(workspaceSso.id, row.id))
  if (data.clientSecret) {
    const [p] = await db.select({ oidcConfig: ssoProvider.oidcConfig }).from(ssoProvider).where(eq(ssoProvider.providerId, row.providerId)).limit(1)
    const cfg = openSsoConfig(row.providerId, p.oidcConfig ?? '{}')
    // Sealed with the workspace key (TD-25), like data source credentials.
    await db.update(ssoProvider).set({ oidcConfig: sealSsoConfig(row.providerId, ctx.workspaceId, { ...cfg, clientSecret: data.clientSecret }) }).where(eq(ssoProvider.providerId, row.providerId))
  }
  // Field names only: never the secret.
  await recordAudit(ctx, { action: 'UPDATE', resource: 'sso_provider', resourceId: row.providerId, changes: { defaultRole: data.defaultRole, enforce: data.enforce, jitProvisioning: data.jitProvisioning, rotatedSecret: Boolean(data.clientSecret) } })
  revalidatePath('/dashboard')
}

// ── SAML 2.0 ─────────────────────────────────────────────────────────────────

const idpInput = z.object({
  /** IdP metadata XML, or an https URL that serves it (e.g. Entra's App Federation Metadata URL). */
  metadata: z.string().trim().max(1_000_000).optional(),
  /** Or the three values typed in. */
  manual: z.object({ entityId: z.string().trim().min(1).max(500), ssoUrl: z.string().trim().min(1).max(1000), certificate: z.string().trim().min(1).max(20_000) }).optional(),
})

/** IdP settings from metadata (XML or https URL) or manual values; null when neither is given. */
async function idpSettings(input: z.infer<typeof idpInput>): Promise<IdpSettings | null> {
  if (input.manual) return manualIdpSettings(input.manual)
  const raw = input.metadata?.trim()
  if (!raw) return null
  if (!/^https?:\/\//i.test(raw)) return parseIdpMetadata(raw)
  let xml: string
  try {
    const res = await safeFetch(raw, { timeoutMs: 8000, headers: { accept: 'application/samlmetadata+xml, application/xml, text/xml' } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    xml = await res.text()
  } catch (err) {
    if (err instanceof UnsafeUrlError) throw new Error(err.message)
    throw new Error(`Could not download the metadata (${err instanceof Error ? err.message : 'failed'}). Paste the XML instead.`)
  }
  return parseIdpMetadata(xml)
}

const samlCreateInput = idpInput.extend({
  label: z.string().trim().min(1).max(80),
  preset: z.enum(SAML_PRESETS),
  domain: z.string().trim().toLowerCase().regex(DOMAIN_RE, 'Enter your email domain, e.g. kmplus.co.id'),
  defaultRole: z.enum(ROLES).default('viewer'),
})

/**
 * Adds a SAML provider. The IdP metadata can come later (setSamlIdp): admins
 * usually need the SP entity ID and ACS URL shown here to create the app first.
 */
async function createSamlProviderImpl(input: z.input<typeof samlCreateInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = samlCreateInput.parse(input)
  if (PUBLIC_EMAIL_DOMAINS.has(data.domain)) throw new Error(`${data.domain} is a public email provider; SSO needs your organization's own domain.`)
  const idp = await idpSettings(data)
  const providerId = `sso-${randomUUID().slice(0, 12)}`
  const sp = spEndpoints(await baseUrl(), providerId)
  const token = randomBytes(18).toString('base64url')
  const samlConfig = samlConfigFor({ preset: data.preset, sp, idp })
  await db.transaction(async (tx) => {
    await tx.insert(ssoProvider).values({ id: newId('ssop'), issuer: idp?.entityId ?? '', samlConfig: sealSsoConfig(providerId, ctx.workspaceId, samlConfig), userId: ctx.userId, providerId, domain: data.domain, domainVerified: false })
    await tx.insert(workspaceSso).values({ id: newId('wsso'), workspaceId: ctx.workspaceId, providerId, label: data.label, preset: data.preset, protocol: 'saml', domain: data.domain, defaultRole: data.defaultRole, verificationToken: token, createdBy: ctx.userId })
  })
  await recordAudit(ctx, { action: 'CREATE', resource: 'sso_provider', resourceId: providerId, changes: { label: data.label, protocol: 'saml', preset: data.preset, domain: data.domain, idpEntityId: idp?.entityId ?? null, defaultRole: data.defaultRole } })
  revalidatePath('/dashboard')
  return { providerId, ...sp }
}

const samlIdpInput = idpInput.extend({ providerId: z.string().min(1).max(60) })

/** Sets or replaces the IdP side of a SAML provider (also how a new signing certificate is rolled over). */
async function setSamlIdpImpl(input: z.input<typeof samlIdpInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = samlIdpInput.parse(input)
  const row = await owned(ctx, data.providerId)
  if (row.protocol !== 'saml') throw new Error('This provider uses OpenID Connect, not SAML.')
  const idp = await idpSettings(data)
  if (!idp) throw new Error('Paste the identity provider metadata (XML or URL), or enter the entity ID, sign-in URL and certificate.')
  const [p] = await db.select({ samlConfig: ssoProvider.samlConfig, issuer: ssoProvider.issuer }).from(ssoProvider).where(eq(ssoProvider.providerId, row.providerId)).limit(1)
  const sp = spEndpoints(await baseUrl(), row.providerId)
  const samlConfig = samlConfigFor({ preset: (SAML_PRESETS as readonly string[]).includes(row.preset) ? (row.preset as SamlPreset) : 'saml', sp, idp })
  await db.update(ssoProvider).set({ issuer: idp.entityId, samlConfig: sealSsoConfig(row.providerId, ctx.workspaceId, samlConfig) }).where(eq(ssoProvider.providerId, row.providerId))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'sso_provider', resourceId: row.providerId, changes: { idpEntityId: idp.entityId, certificateExpires: idp.certificateExpires }, diff: { issuer: { from: p?.issuer ?? '', to: idp.entityId }, ...(p?.samlConfig && JSON.parse(p.samlConfig).entryPoint !== idp.ssoUrl ? { ssoUrl: { from: JSON.parse(p.samlConfig).entryPoint ?? '', to: idp.ssoUrl } } : {}) } })
  revalidatePath('/dashboard')
  return { entityId: idp.entityId, ssoUrl: idp.ssoUrl, certificateExpires: idp.certificateExpires }
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

export async function createSamlProvider(...args: Parameters<typeof createSamlProviderImpl>) {
  return guard(() => createSamlProviderImpl(...args))
}

export async function setSamlIdp(...args: Parameters<typeof setSamlIdpImpl>) {
  return guard(() => setSamlIdpImpl(...args))
}

export async function deleteSsoProvider(...args: Parameters<typeof deleteSsoProviderImpl>) {
  return guard(() => deleteSsoProviderImpl(...args))
}
