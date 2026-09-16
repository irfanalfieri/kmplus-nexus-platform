import { createHmac, randomUUID, timingSafeEqual } from 'crypto'
import type { ConnectorCredentials } from '../types'

export type SalesforceAuthMethod = 'web_oauth' | 'password'
export type SalesforceLoginHost = 'login' | 'test'

export interface SalesforceTokenResponse {
  access_token: string
  refresh_token?: string
  instance_url: string
  id?: string
  token_type?: string
  issued_at?: string
  signature?: string
}

export interface SalesforceOAuthSession {
  accessToken: string
  refreshToken: string
  instanceUrl: string
  loginHost: SalesforceLoginHost
  clientId: string
  clientSecret: string
}

const SF_API_VERSION = 'v59.0'

function appSecret() {
  const secret = process.env.BETTER_AUTH_SECRET
  if (!secret) throw new Error('BETTER_AUTH_SECRET is required for Salesforce OAuth.')
  return secret
}

export function getAppBaseUrl() {
  return (
    process.env.BETTER_AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000')
  ).replace(/\/+$/, '')
}

export function getSalesforceRedirectUri() {
  return `${getAppBaseUrl()}/api/connectors/salesforce/callback`
}

export function loginHostToUrl(host: SalesforceLoginHost) {
  return host === 'test' ? 'https://test.salesforce.com' : 'https://login.salesforce.com'
}

export function parseSalesforceLoginHost(raw?: string): SalesforceLoginHost {
  return raw === 'test' || raw?.includes('test.salesforce') ? 'test' : 'login'
}

export function parseSalesforceAuthMethod(raw?: string): SalesforceAuthMethod {
  return raw === 'web_oauth' || raw === 'password' ? raw : 'web_oauth'
}

export function signOAuthState(payload: Record<string, unknown>) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', appSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyOAuthState(token: string): Record<string, unknown> | null {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const expected = createHmac('sha256', appSecret()).update(body).digest('base64url')
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  } catch {
    return null
  }
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export function buildSalesforceAuthorizeUrl(input: {
  clientId: string
  loginHost: SalesforceLoginHost
  state: string
}) {
  const base = loginHostToUrl(input.loginHost)
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId.trim(),
    redirect_uri: getSalesforceRedirectUri(),
    scope: 'api refresh_token offline_access',
    state: input.state,
    prompt: 'login consent',
  })
  return `${base}/services/oauth2/authorize?${params.toString()}`
}

export async function exchangeSalesforceCode(input: {
  code: string
  clientId: string
  clientSecret: string
  loginHost: SalesforceLoginHost
}): Promise<SalesforceTokenResponse> {
  const base = loginHostToUrl(input.loginHost)
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
    redirect_uri: getSalesforceRedirectUri(),
  })

  const response = await fetch(`${base}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Salesforce token exchange failed (${response.status}): ${text.slice(0, 300)}`)
  }

  return JSON.parse(text) as SalesforceTokenResponse
}

export async function refreshSalesforceToken(input: {
  refreshToken: string
  clientId: string
  clientSecret: string
  loginHost: SalesforceLoginHost
}): Promise<SalesforceTokenResponse> {
  const base = loginHostToUrl(input.loginHost)
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken.trim(),
    client_id: input.clientId.trim(),
    client_secret: input.clientSecret.trim(),
  })

  const response = await fetch(`${base}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body,
    cache: 'no-store',
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Salesforce token refresh failed (${response.status}): ${text.slice(0, 300)}`)
  }

  return JSON.parse(text) as SalesforceTokenResponse
}

async function passwordGrantToken(credentials: ConnectorCredentials): Promise<SalesforceTokenResponse> {
  const loginHost = parseSalesforceLoginHost(credentials.loginHost)
  const base = credentials.instanceUrl?.trim().replace(/\/+$/, '') || loginHostToUrl(loginHost)
  const clientId = credentials.clientId?.trim()
  const clientSecret = credentials.clientSecret?.trim()
  const username = credentials.username?.trim()
  const password = credentials.password ?? ''

  if (!clientId || !clientSecret || !username) {
    throw new Error('Salesforce consumer key/secret and username are required for password auth.')
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password,
  })

  const response = await fetch(`${base}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Salesforce auth failed (${response.status}): ${text.slice(0, 200)}`)
  }

  return response.json() as Promise<SalesforceTokenResponse>
}

export function credentialsFromOAuthResult(
  base: ConnectorCredentials,
  tokens: SalesforceTokenResponse
): ConnectorCredentials {
  return {
    ...base,
    authMethod: 'web_oauth',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? base.refreshToken ?? '',
    instanceUrl: tokens.instance_url,
    connectedAt: new Date().toISOString(),
  }
}

export function validateSalesforceCredentials(values: Record<string, string>): boolean {
  const authMethod = parseSalesforceAuthMethod(values.authMethod)
  const clientId = values.clientId?.trim()
  const clientSecret = values.clientSecret?.trim()

  if (!clientId || !clientSecret) return false

  if (authMethod === 'web_oauth') {
    return Boolean(values.accessToken?.trim() && values.instanceUrl?.trim())
  }

  return Boolean(values.username?.trim() && values.password?.trim())
}

/** Resolve a usable access token + instance URL (web OAuth with refresh, or password grant). */
export async function resolveSalesforceAuth(
  credentials: ConnectorCredentials
): Promise<{ access_token: string; instance_url: string; refreshed?: ConnectorCredentials }> {
  const authMethod = parseSalesforceAuthMethod(credentials.authMethod)

  if (authMethod === 'web_oauth' || credentials.accessToken?.trim()) {
    const clientId = credentials.clientId?.trim() ?? ''
    const clientSecret = credentials.clientSecret?.trim() ?? ''
    const loginHost = parseSalesforceLoginHost(credentials.loginHost)
    const accessToken = credentials.accessToken?.trim() ?? ''
    const refreshToken = credentials.refreshToken?.trim() ?? ''
    let instanceUrl = credentials.instanceUrl?.trim().replace(/\/+$/, '') ?? ''

    if (!accessToken || !instanceUrl) {
      throw new Error('Connect with Salesforce first (web login required).')
    }

    const probe = await fetch(`${instanceUrl}/services/data/${SF_API_VERSION}/`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      cache: 'no-store',
    })

    if (probe.ok) {
      return { access_token: accessToken, instance_url: instanceUrl }
    }

    if (probe.status === 401 && refreshToken && clientId && clientSecret) {
      const refreshed = await refreshSalesforceToken({
        refreshToken,
        clientId,
        clientSecret,
        loginHost,
      })
      instanceUrl = refreshed.instance_url.replace(/\/+$/, '')
      return {
        access_token: refreshed.access_token,
        instance_url: instanceUrl,
        refreshed: credentialsFromOAuthResult(credentials, {
          ...refreshed,
          refresh_token: refreshed.refresh_token ?? refreshToken,
        }),
      }
    }

    throw new Error('Salesforce session expired. Reconnect with Salesforce.')
  }

  const auth = await passwordGrantToken(credentials)
  return {
    access_token: auth.access_token,
    instance_url: auth.instance_url.replace(/\/+$/, ''),
  }
}

export { SF_API_VERSION }
