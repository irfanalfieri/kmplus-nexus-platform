import type { ConnectionTestResult, ConnectorCredentials } from '../types'
import { configError, request, requestJson } from '../http'
import { googleAccessToken, parseServiceAccount } from '@/lib/net/cloud-auth'
import type { SecretValue } from '@/lib/secrets/types'

/**
 * Google Cloud Secret Manager through a service account key (role "Secret
 * Manager Secret Accessor"). A secret is referenced by name, optionally
 * name/version (default: latest). JSON secrets expose their fields.
 */

const SERVICE = 'Google Secret Manager'
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform'

function settings(credentials: ConnectorCredentials) {
  const sa = parseServiceAccount(credentials.serviceAccountJson)
  const projectId = credentials.projectId?.trim() || sa.project_id || ''
  if (!projectId) throw configError('Enter the Google Cloud project ID.')
  const api = (credentials.apiEndpoint?.trim() || 'https://secretmanager.googleapis.com').replace(/\/+$/, '')
  return { sa, projectId, api }
}

async function auth(credentials: ConnectorCredentials) {
  return { authorization: `Bearer ${await googleAccessToken(settings(credentials).sa, SCOPE)}`, accept: 'application/json' }
}

export async function listGcpSecrets(credentials: ConnectorCredentials, prefix = ''): Promise<string[]> {
  const { projectId, api } = settings(credentials)
  const h = await auth(credentials)
  const names: string[] = []
  let token = ''
  do {
    const page = await requestJson<{ secrets?: { name: string }[]; nextPageToken?: string }>(
      SERVICE,
      `${api}/v1/projects/${encodeURIComponent(projectId)}/secrets?pageSize=250${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`,
      { headers: h }
    )
    names.push(...(page.secrets ?? []).map((s) => s.name.split('/secrets/')[1] ?? s.name))
    token = page.nextPageToken ?? ''
  } while (token && names.length < 500)
  return names.filter((n) => n.startsWith(prefix)).slice(0, 500)
}

export async function testGcpSecretsConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const names = await listGcpSecrets(credentials)
    return { ok: true, message: `Connected to ${SERVICE} (project ${settings(credentials).projectId}); ${names.length} secrets visible.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function getGcpSecret(credentials: ConnectorCredentials, path: string): Promise<SecretValue> {
  const { projectId, api } = settings(credentials)
  const [name, version = 'latest'] = path.replace(/^\/+/, '').split('/')
  if (!/^[A-Za-z0-9_-]{1,255}$/.test(name ?? '')) throw configError('Google secret names use letters, digits, - and _.')
  const res = await request(SERVICE, `${api}/v1/projects/${encodeURIComponent(projectId)}/secrets/${name}/versions/${encodeURIComponent(version)}:access`, { headers: await auth(credentials) })
  if (res.status === 404) throw configError(`Secret "${name}" not found in ${SERVICE}.`)
  if (res.status === 401 || res.status === 403) throw configError(`${SERVICE} rejected the credentials (HTTP ${res.status}).`)
  if (!res.ok) throw Object.assign(new Error(`${SERVICE} returned HTTP ${res.status}`), { retryable: res.status >= 500 || res.status === 429 })
  const text = Buffer.from(((await res.json()) as { payload?: { data?: string } }).payload?.data ?? '', 'base64').toString('utf8')
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
  } catch {
    /* plain text */
  }
  return text
}
