import type { ConnectionTestResult, ConnectorCredentials } from '../types'
import { configError, requestJson } from '../http'
import type { SecretValue } from '@/lib/secrets/types'

/**
 * Doppler as a secrets manager, with a service token (read-only, scoped to one
 * project config). A secret is referenced by its name, e.g. HR_DB_PASSWORD.
 */

const SERVICE = 'Doppler'

function settings(credentials: ConnectorCredentials) {
  const token = credentials.serviceToken?.trim() ?? ''
  if (!token) throw configError('Enter a Doppler service token (dp.st.…).')
  const api = (credentials.apiUrl?.trim() || 'https://api.doppler.com').replace(/\/+$/, '')
  return { token, api }
}

/** The config's secrets (names → values); held only in memory for the call. */
async function download(credentials: ConnectorCredentials): Promise<Record<string, string>> {
  const { token, api } = settings(credentials)
  return requestJson<Record<string, string>>(SERVICE, `${api}/v3/configs/config/secrets/download?format=json&include_dynamic_secrets=false`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
  })
}

export async function listDopplerSecrets(credentials: ConnectorCredentials, prefix = ''): Promise<string[]> {
  return Object.keys(await download(credentials))
    .filter((n) => !n.startsWith('DOPPLER_') && n.startsWith(prefix))
    .sort()
    .slice(0, 500)
}

export async function testDopplerConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const all = await download(credentials)
    const scope = all.DOPPLER_PROJECT && all.DOPPLER_CONFIG ? ` (${all.DOPPLER_PROJECT} / ${all.DOPPLER_CONFIG})` : ''
    return { ok: true, message: `Connected to ${SERVICE}${scope}; ${Object.keys(all).filter((n) => !n.startsWith('DOPPLER_')).length} secrets visible.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function getDopplerSecret(credentials: ConnectorCredentials, path: string): Promise<SecretValue> {
  const all = await download(credentials)
  const name = path.trim()
  if (!(name in all)) throw configError(`Secret "${name}" not found in ${SERVICE}.`)
  return all[name]
}
