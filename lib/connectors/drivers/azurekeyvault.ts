import type { ConnectionTestResult, ConnectorCredentials } from '../types'
import { baseUrlOf, configError, request, requestJson } from '../http'
import { azureAccessToken } from '@/lib/net/cloud-auth'
import type { SecretValue } from '@/lib/secrets/types'

/**
 * Azure Key Vault secrets through an app registration (client credentials):
 * give it the "Key Vault Secrets User" role on the vault. A secret is referenced
 * by name, optionally name/version.
 */

const SERVICE = 'Azure Key Vault'
const API = 'api-version=7.4'

function settings(credentials: ConnectorCredentials) {
  return {
    vaultUrl: baseUrlOf(credentials.vaultUrl, 'The vault URL'),
    tenantId: credentials.tenantId?.trim() ?? '',
    clientId: credentials.clientId?.trim() ?? '',
    clientSecret: credentials.clientSecret?.trim() ?? '',
    authorityHost: credentials.authorityHost?.trim() || undefined,
  }
}

async function headers(credentials: ConnectorCredentials) {
  const s = settings(credentials)
  // The token audience is the Key Vault resource of the vault's cloud (public, China, US Gov …).
  const resource = new URL(s.vaultUrl).hostname.replace(/^[^.]+\./, 'https://')
  const token = await azureAccessToken({ tenantId: s.tenantId, clientId: s.clientId, clientSecret: s.clientSecret, authorityHost: s.authorityHost, scope: `${resource}/.default` })
  return { authorization: `Bearer ${token}`, accept: 'application/json' }
}

export async function listAzureSecrets(credentials: ConnectorCredentials, prefix = ''): Promise<string[]> {
  const { vaultUrl } = settings(credentials)
  const h = await headers(credentials)
  const names: string[] = []
  let next: string | undefined = `${vaultUrl}/secrets?${API}&maxresults=25`
  while (next && names.length < 500) {
    // nextLink stays on the vault's own host.
    if (new URL(next).origin !== new URL(vaultUrl).origin) break
    const page: { value?: { id: string }[]; nextLink?: string | null } = await requestJson(SERVICE, next, { headers: h })
    names.push(...(page.value ?? []).map((s) => s.id.split('/secrets/')[1]?.split('/')[0] ?? '').filter(Boolean))
    next = page.nextLink ?? undefined
  }
  return names.filter((n) => n.startsWith(prefix)).slice(0, 500)
}

export async function testAzureKeyVaultConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const names = await listAzureSecrets(credentials)
    return { ok: true, message: `Connected to ${SERVICE}; ${names.length} secrets visible.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function getAzureSecret(credentials: ConnectorCredentials, path: string): Promise<SecretValue> {
  const { vaultUrl } = settings(credentials)
  const [name, version] = path.replace(/^\/+/, '').split('/')
  if (!/^[A-Za-z0-9-]{1,127}$/.test(name ?? '')) throw configError('Azure Key Vault secret names use letters, digits and dashes.')
  const res = await request(SERVICE, `${vaultUrl}/secrets/${name}${version ? `/${encodeURIComponent(version)}` : ''}?${API}`, { headers: await headers(credentials) })
  if (res.status === 404) throw configError(`Secret "${name}" not found in ${SERVICE}.`)
  if (res.status === 401 || res.status === 403) throw configError(`${SERVICE} rejected the credentials (HTTP ${res.status}).`)
  if (!res.ok) throw Object.assign(new Error(`${SERVICE} returned HTTP ${res.status}`), { retryable: res.status >= 500 || res.status === 429 })
  const body = (await res.json()) as { value?: string }
  return body.value ?? ''
}
