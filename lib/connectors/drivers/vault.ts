import type { ConnectionTestResult, ConnectorCredentials } from '../types'
import { baseUrlOf, configError, request, requestJson } from '../http'
import type { SecretValue } from '@/lib/secrets/types'

/**
 * HashiCorp Vault (self-managed or HCP Vault) as a secrets manager: KV v1/v2
 * secrets, token or AppRole sign-in, optional namespace (Enterprise / HCP) and
 * company CA. Read-only: Nexus only reads secret values it is pointed at.
 */

const SERVICE = 'Vault'

function settings(credentials: ConnectorCredentials) {
  const url = baseUrlOf(credentials.url, 'The Vault address')
  const mount = (credentials.kvMount?.trim() || 'secret').replace(/^\/+|\/+$/g, '')
  const kvVersion = credentials.kvVersion?.trim() === '1' ? 1 : 2
  const headers: Record<string, string> = { accept: 'application/json' }
  if (credentials.namespace?.trim()) headers['x-vault-namespace'] = credentials.namespace.trim()
  const network = credentials.caCert?.trim() ? { tls: { caCert: credentials.caCert } } : undefined
  return { url, mount, kvVersion, headers, network }
}

const tokens = new Map<string, { token: string; expires: number }>()

async function token(credentials: ConnectorCredentials): Promise<string> {
  if (credentials.token?.trim()) return credentials.token.trim()
  const roleId = credentials.roleId?.trim()
  const secretId = credentials.secretId?.trim()
  if (!roleId || !secretId) throw configError('Vault needs a token, or an AppRole role ID and secret ID.')
  const { url, headers, network } = settings(credentials)
  const key = `${url}|${credentials.namespace ?? ''}|${roleId}`
  const hit = tokens.get(key)
  if (hit && hit.expires > Date.now() + 30_000) return hit.token
  const body = await requestJson<{ auth?: { client_token?: string; lease_duration?: number } }>(SERVICE, `${url}/v1/auth/approle/login`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ role_id: roleId, secret_id: secretId }),
    network,
  })
  if (!body.auth?.client_token) throw configError('Vault AppRole sign-in returned no token.')
  tokens.set(key, { token: body.auth.client_token, expires: Date.now() + (body.auth.lease_duration ?? 300) * 1000 })
  return body.auth.client_token
}

async function vault<T>(credentials: ConnectorCredentials, path: string): Promise<T> {
  const { url, headers, network } = settings(credentials)
  return requestJson<T>(SERVICE, `${url}${path}`, { headers: { ...headers, 'x-vault-token': await token(credentials) }, network })
}

export async function testVaultConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const self = await vault<{ data?: { display_name?: string; policies?: string[] } }>(credentials, '/v1/auth/token/lookup-self')
    const names = await listVaultSecrets(credentials).catch(() => null)
    const who = self.data?.display_name ?? 'token'
    return { ok: true, message: names ? `Connected to Vault as ${who}; ${names.length} secrets visible in ${settings(credentials).mount}/.` : `Connected to Vault as ${who}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

/** Secret paths under the KV mount (recursively, up to 500), never values. */
export async function listVaultSecrets(credentials: ConnectorCredentials, prefix = ''): Promise<string[]> {
  const { mount, kvVersion } = settings(credentials)
  const out: string[] = []
  const walk = async (dir: string, depth: number) => {
    if (out.length >= 500 || depth > 6) return
    const listPath = kvVersion === 2 ? `/v1/${mount}/metadata/${dir}` : `/v1/${mount}/${dir}`
    let keys: string[] = []
    try {
      keys = (await vault<{ data?: { keys?: string[] } }>(credentials, `${listPath}?list=true`)).data?.keys ?? []
    } catch (err) {
      if (/HTTP 404/.test(String((err as Error).message))) return
      throw err
    }
    for (const k of keys) {
      if (k.endsWith('/')) await walk(`${dir}${k}`, depth + 1)
      else out.push(`${dir}${k}`)
    }
  }
  await walk(prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix, 0)
  return out.slice(0, 500)
}

/** All fields of one secret (KV v2: latest version). */
export async function getVaultSecret(credentials: ConnectorCredentials, path: string): Promise<SecretValue> {
  const { mount, kvVersion, url, headers, network } = settings(credentials)
  const clean = path.replace(/^\/+/, '')
  const full = kvVersion === 2 ? `/v1/${mount}/data/${clean}` : `/v1/${mount}/${clean}`
  const res = await request(SERVICE, `${url}${full}`, { headers: { ...headers, 'x-vault-token': await token(credentials) }, network })
  if (res.status === 404) throw configError(`Secret "${clean}" not found in ${SERVICE}.`)
  if (res.status === 401 || res.status === 403) throw configError(`${SERVICE} rejected the credentials (HTTP ${res.status}).`)
  if (!res.ok) throw Object.assign(new Error(`${SERVICE} returned HTTP ${res.status}`), { retryable: res.status >= 500 })
  const body = (await res.json()) as { data?: { data?: Record<string, unknown> } & Record<string, unknown> }
  const fields = (kvVersion === 2 ? body.data?.data : body.data) ?? {}
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
}
