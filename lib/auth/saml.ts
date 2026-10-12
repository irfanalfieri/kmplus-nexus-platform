import { X509Certificate } from 'node:crypto'

/**
 * SAML 2.0 single sign-on (GV-8), server side. The Better Auth SSO plugin
 * (samlify) runs the protocol: it sends the AuthnRequest, checks the response
 * signature, audience, time window and replay, and signs the user in. Nexus
 * stores what it needs: the IdP's entity ID, sign-in URL and signing
 * certificate (from the IdP's metadata), and tells the admin the SP values to
 * enter at the IdP. Pure apart from certificate parsing; covered by
 * scripts/engine-tests.ts.
 */

export { SAML_PRESETS, type SamlPreset } from './sso-presets'
import type { SamlPreset } from './sso-presets'

/** Where each IdP puts the user's email and names (the plugin falls back to the NameID for email). */
export const SAML_ATTRIBUTE_MAPPING: Record<SamlPreset, { email: string; firstName?: string; lastName?: string; name?: string }> = {
  azure: {
    email: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
    firstName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname',
    lastName: 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname',
    name: 'http://schemas.microsoft.com/identity/claims/displayname',
  },
  okta: { email: 'email', firstName: 'firstName', lastName: 'lastName' },
  google: { email: 'email', firstName: 'firstName', lastName: 'lastName' },
  saml: { email: 'email', firstName: 'givenName', lastName: 'surname', name: 'displayName' },
}

/** The values the admin enters at the identity provider for this provider id. */
export function spEndpoints(baseUrl: string, providerId: string) {
  const base = baseUrl.replace(/\/+$/, '')
  return {
    entityId: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
    acsUrl: `${base}/api/auth/sso/saml2/sp/acs/${providerId}`,
    metadataUrl: `${base}/api/auth/sso/saml2/sp/metadata?providerId=${providerId}`,
  }
}

export interface IdpSettings {
  entityId: string
  ssoUrl: string
  /** Base64 DER bodies (no PEM header), as samlify expects. */
  certificates: string[]
  /** Latest expiry among the signing certificates. */
  certificateExpires: string
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(tag) ?? new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`).exec(tag)
  return m ? decode(m[1]) : ''
}

/** Base64 body of a certificate given as PEM or bare base64; throws when it isn't a valid X.509 certificate. */
export function certificateBody(input: string): { body: string; expires: Date; subject: string } {
  const body = input.replace(/-----(BEGIN|END) CERTIFICATE-----/g, '').replace(/\s+/g, '')
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new Error('The signing certificate is not valid base64 or PEM.')
  let cert: X509Certificate
  try {
    cert = new X509Certificate(Buffer.from(body, 'base64'))
  } catch {
    throw new Error('The signing certificate could not be read. Paste the X.509 certificate (PEM or base64) from the identity provider.')
  }
  return { body, expires: new Date(cert.validTo), subject: cert.subject }
}

function checkSsoUrl(url: string) {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    throw new Error('The sign-in (SSO) URL is not a valid URL.')
  }
  if (u.protocol !== 'https:') throw new Error('The sign-in (SSO) URL must use https.')
  return u.toString()
}

function settings(entityId: string, ssoUrl: string, certs: string[], now: Date): IdpSettings {
  if (!entityId.trim()) throw new Error('The identity provider has no entity ID (issuer).')
  const parsed = certs.map(certificateBody)
  if (!parsed.length) throw new Error('The metadata has no signing certificate.')
  const valid = parsed.filter((c) => c.expires > now)
  if (!valid.length) throw new Error(`The signing certificate expired on ${parsed[0].expires.toISOString().slice(0, 10)}. Download fresh metadata from the identity provider.`)
  const latest = valid.reduce((a, b) => (b.expires > a.expires ? b : a))
  return { entityId: entityId.trim(), ssoUrl: checkSsoUrl(ssoUrl.trim()), certificates: [...new Set(valid.map((c) => c.body))], certificateExpires: latest.expires.toISOString() }
}

/**
 * Reads an IdP's SAML metadata XML: entity ID, the HTTP-Redirect (else POST)
 * sign-in URL, and signing certificates (KeyDescriptor use="signing" or unspecified).
 */
export function parseIdpMetadata(xml: string, now = new Date()): IdpSettings {
  if (xml.length > 1_000_000) throw new Error('The metadata is too large.')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Metadata with a DOCTYPE or entities is not accepted.')
  const entity = /<(?:[\w-]+:)?EntityDescriptor\b[^>]*>/.exec(xml)
  if (!entity) throw new Error('This is not SAML metadata (no EntityDescriptor). Paste the identity provider (federation) metadata XML or its URL.')
  const idp = /<(?:[\w-]+:)?IDPSSODescriptor\b[\s\S]*?<\/(?:[\w-]+:)?IDPSSODescriptor>/.exec(xml)
  if (!idp) throw new Error('The metadata describes no identity provider (IDPSSODescriptor). Use the IdP metadata, not the service provider metadata.')
  const block = idp[0]
  const certs: string[] = []
  for (const kd of block.matchAll(/<(?:[\w-]+:)?KeyDescriptor\b([^>]*)>([\s\S]*?)<\/(?:[\w-]+:)?KeyDescriptor>/g)) {
    if (attr(kd[1], 'use') === 'encryption') continue
    for (const c of kd[2].matchAll(/<(?:[\w-]+:)?X509Certificate>([\s\S]*?)<\/(?:[\w-]+:)?X509Certificate>/g)) certs.push(c[1])
  }
  const services = [...block.matchAll(/<(?:[\w-]+:)?SingleSignOnService\b[^>]*>/g)].map((m) => ({ binding: attr(m[0], 'Binding'), location: attr(m[0], 'Location') }))
  const sso = services.find((s) => s.binding.endsWith('HTTP-Redirect')) ?? services.find((s) => s.binding.endsWith('HTTP-POST'))
  if (!sso?.location) throw new Error('The metadata has no HTTP-Redirect or HTTP-POST SingleSignOnService.')
  return settings(attr(entity[0], 'entityID'), sso.location, certs, now)
}

/** Settings typed in by hand (entity ID, sign-in URL, certificate). */
export function manualIdpSettings(input: { entityId: string; ssoUrl: string; certificate: string }, now = new Date()): IdpSettings {
  return settings(input.entityId, input.ssoUrl, [input.certificate], now)
}

/** samlConfig JSON the plugin reads (no secrets: Nexus doesn't sign requests or decrypt assertions). */
export function samlConfigFor(opts: { preset: SamlPreset; sp: ReturnType<typeof spEndpoints>; idp: IdpSettings | null }) {
  const m = SAML_ATTRIBUTE_MAPPING[opts.preset]
  return {
    issuer: opts.idp?.entityId ?? '',
    entryPoint: opts.idp?.ssoUrl ?? '',
    cert: opts.idp ? (opts.idp.certificates.length === 1 ? opts.idp.certificates[0] : opts.idp.certificates) : '',
    callbackUrl: opts.sp.acsUrl,
    audience: opts.sp.entityId,
    spMetadata: { entityID: opts.sp.entityId },
    mapping: { id: 'nameID', email: m.email, ...(m.firstName ? { firstName: m.firstName } : {}), ...(m.lastName ? { lastName: m.lastName } : {}), ...(m.name ? { name: m.name } : {}) },
    certificateExpires: opts.idp?.certificateExpires ?? null,
  }
}
