import type { ConnectionTestResult, ConnectorCredentials } from '../types'
import { configError, request } from '../http'
import { signAwsRequest } from '@/lib/net/aws-sigv4'
import type { SecretValue } from '@/lib/secrets/types'

/**
 * AWS Secrets Manager as a secrets manager (Signature V4, no SDK). A secret is
 * referenced by name or ARN; JSON secrets expose their fields (#password).
 * Use an IAM user or role limited to secretsmanager:GetSecretValue and
 * secretsmanager:ListSecrets on the secrets Nexus needs.
 */

const SERVICE = 'AWS Secrets Manager'

function settings(credentials: ConnectorCredentials) {
  const region = credentials.region?.trim() || 'us-east-1'
  const accessKeyId = credentials.accessKeyId?.trim() ?? ''
  const secretAccessKey = credentials.secretAccessKey?.trim() ?? ''
  if (!accessKeyId || !secretAccessKey) throw configError('AWS access key ID and secret access key are required.')
  const endpoint = (credentials.endpoint?.trim() || `https://secretsmanager.${region}.amazonaws.com`).replace(/\/+$/, '')
  return { region, endpoint, aws: { accessKeyId, secretAccessKey, sessionToken: credentials.sessionToken?.trim() || undefined } }
}

async function call<T>(credentials: ConnectorCredentials, action: string, payload: object): Promise<T> {
  const { region, endpoint, aws } = settings(credentials)
  const body = JSON.stringify(payload)
  const headers = signAwsRequest({
    method: 'POST',
    url: `${endpoint}/`,
    region,
    service: 'secretsmanager',
    credentials: aws,
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `secretsmanager.${action}` },
    body,
  })
  const res = await request(SERVICE, `${endpoint}/`, { method: 'POST', headers, body })
  const text = await res.text()
  if (!res.ok) {
    const err = (() => {
      try {
        return JSON.parse(text) as { __type?: string; message?: string; Message?: string }
      } catch {
        return {}
      }
    })()
    const type = (err.__type ?? '').split('#').pop() ?? ''
    if (type === 'ResourceNotFoundException') throw configError(`Secret not found in ${SERVICE}.`)
    if (res.status === 400 || res.status === 403) throw configError(`${SERVICE}: ${type || `HTTP ${res.status}`}${err.message || err.Message ? ` (${err.message ?? err.Message})` : ''}`)
    throw Object.assign(new Error(`${SERVICE} returned HTTP ${res.status}`), { retryable: res.status >= 500 || res.status === 429 })
  }
  return JSON.parse(text) as T
}

export async function listAwsSecrets(credentials: ConnectorCredentials, prefix = ''): Promise<string[]> {
  const names: string[] = []
  let next: string | undefined
  do {
    const page = await call<{ SecretList?: { Name: string }[]; NextToken?: string }>(credentials, 'ListSecrets', {
      MaxResults: 100,
      ...(next ? { NextToken: next } : {}),
      ...(prefix ? { Filters: [{ Key: 'name', Values: [prefix] }] } : {}),
    })
    names.push(...(page.SecretList ?? []).map((s) => s.Name))
    next = page.NextToken
  } while (next && names.length < 500)
  return names.slice(0, 500)
}

export async function testAwsSecretsConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const names = await listAwsSecrets(credentials)
    return { ok: true, message: `Connected to ${SERVICE} (${settings(credentials).region}); ${names.length} secrets visible.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : `${SERVICE} connection failed.` }
  }
}

export async function getAwsSecret(credentials: ConnectorCredentials, path: string): Promise<SecretValue> {
  const out = await call<{ SecretString?: string; SecretBinary?: string }>(credentials, 'GetSecretValue', { SecretId: path })
  const text = out.SecretString ?? (out.SecretBinary ? Buffer.from(out.SecretBinary, 'base64').toString('utf8') : '')
  try {
    const parsed = JSON.parse(text) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]))
    }
  } catch {
    /* a plain string secret */
  }
  return text
}
