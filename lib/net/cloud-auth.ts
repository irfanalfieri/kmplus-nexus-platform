import { createSign } from 'node:crypto'
import { connectorFetch } from './safe-url'

/**
 * Access tokens for cloud APIs (no SDKs), cached until shortly before they expire:
 * - Google: a service account key (JSON) signs a JWT that is exchanged for a token.
 * - Microsoft Entra ID: an app registration's client ID and secret (client credentials).
 * Server and agent only; secrets never leave this module except in the token request.
 */

const cache = new Map<string, { token: string; expires: number }>()

function cached(key: string) {
  const hit = cache.get(key)
  return hit && hit.expires > Date.now() + 60_000 ? hit.token : null
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export interface GoogleServiceAccount {
  client_email: string
  private_key: string
  token_uri?: string
  project_id?: string
}

/** Parses the service account key JSON a user pasted (one line or many). */
export function parseServiceAccount(raw: string | undefined): GoogleServiceAccount {
  let parsed: unknown
  try {
    parsed = JSON.parse((raw ?? '').trim())
  } catch {
    throw Object.assign(new Error('Paste the service account key as JSON (the file you downloaded from Google Cloud).'), { retryable: false })
  }
  const sa = parsed as Partial<GoogleServiceAccount>
  if (!sa.client_email || !sa.private_key) throw Object.assign(new Error('The service account key needs client_email and private_key.'), { retryable: false })
  return { client_email: sa.client_email, private_key: sa.private_key, token_uri: sa.token_uri, project_id: sa.project_id }
}

export async function googleAccessToken(sa: GoogleServiceAccount, scope: string): Promise<string> {
  const tokenUri = sa.token_uri || 'https://oauth2.googleapis.com/token'
  const key = `g:${sa.client_email}:${scope}:${tokenUri}`
  const hit = cached(key)
  if (hit) return hit
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope, aud: tokenUri, iat: now, exp: now + 3600 }))}`
  const signature = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key)
  const res = await connectorFetch(tokenUri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(signature)}` }).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !body.access_token) throw Object.assign(new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? `HTTP ${res.status}`}`), { retryable: res.status >= 500 })
  cache.set(key, { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 })
  return body.access_token
}

export async function azureAccessToken(opts: { tenantId: string; clientId: string; clientSecret: string; scope: string; authorityHost?: string }): Promise<string> {
  const host = (opts.authorityHost?.trim() || 'https://login.microsoftonline.com').replace(/\/+$/, '')
  if (!opts.tenantId || !opts.clientId || !opts.clientSecret) throw Object.assign(new Error('Tenant ID, client ID and client secret are required.'), { retryable: false })
  const key = `az:${host}:${opts.tenantId}:${opts.clientId}:${opts.scope}`
  const hit = cached(key)
  if (hit) return hit
  const res = await connectorFetch(`${host}/${encodeURIComponent(opts.tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: opts.clientId, client_secret: opts.clientSecret, scope: opts.scope }).toString(),
    signal: AbortSignal.timeout(20_000),
  })
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string; error?: string }
  if (!res.ok || !body.access_token) throw Object.assign(new Error(`Microsoft Entra ID sign-in failed: ${(body.error_description ?? body.error ?? `HTTP ${res.status}`).split('\r\n')[0]}`), { retryable: res.status >= 500 })
  cache.set(key, { token: body.access_token, expires: Date.now() + (body.expires_in ?? 3600) * 1000 })
  return body.access_token
}
