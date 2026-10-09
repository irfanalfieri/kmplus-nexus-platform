import { Client } from 'ldapts'
import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'

/**
 * Active Directory / LDAP (read-only). Objects exposed to pipelines:
 *   users, groups, organizational_units
 * Each entry becomes a row: dn + its attributes. Multi-valued attributes become
 * "; "-joined text, binary AD attributes (objectGUID, objectSid) become hex.
 */

type Row = Record<string, unknown>

const OBJECT_FILTERS: Record<string, { label: string; filter: string }> = {
  users: { label: 'Users', filter: '(|(&(objectCategory=person)(objectClass=user))(objectClass=inetOrgPerson)(objectClass=person))' },
  groups: { label: 'Groups', filter: '(|(objectClass=group)(objectClass=groupOfNames)(objectClass=groupOfUniqueNames))' },
  organizational_units: { label: 'Organizational units', filter: '(objectClass=organizationalUnit)' },
}

const BINARY_ATTRIBUTES = ['objectGUID', 'objectSid', 'thumbnailPhoto', 'jpegPhoto', 'userCertificate']
const SKIP_ATTRIBUTES = new Set(['thumbnailPhoto', 'jpegPhoto', 'userCertificate', 'userPassword', 'unicodePwd'])

function settings(credentials: ConnectorCredentials) {
  const url = credentials.url?.trim() ?? ''
  if (!/^ldaps?:\/\//i.test(url)) throw new Error('LDAP URL must start with ldap:// or ldaps://')
  const baseDN = credentials.baseDN?.trim() ?? ''
  if (!baseDN) throw new Error('Base DN is required (e.g. DC=corp,DC=example,DC=com).')
  return {
    url,
    baseDN,
    bindDN: credentials.bindDN?.trim() ?? '',
    password: credentials.password ?? '',
    userFilter: credentials.userFilter?.trim() || OBJECT_FILTERS.users.filter,
    allowSelfSigned: credentials.allowSelfSigned === 'true',
  }
}

async function withClient<T>(credentials: ConnectorCredentials, fn: (client: Client, cfg: ReturnType<typeof settings>) => Promise<T>) {
  const cfg = settings(credentials)
  const client = new Client({
    url: cfg.url,
    timeout: 30_000,
    connectTimeout: 10_000,
    tlsOptions: cfg.url.toLowerCase().startsWith('ldaps') ? { rejectUnauthorized: !cfg.allowSelfSigned } : undefined,
  })
  try {
    if (cfg.bindDN) await client.bind(cfg.bindDN, cfg.password)
    return await fn(client, cfg)
  } finally {
    await client.unbind().catch(() => undefined)
  }
}

function toRow(entry: Record<string, unknown>): Row {
  const row: Row = {}
  for (const [key, value] of Object.entries(entry)) {
    if (SKIP_ATTRIBUTES.has(key)) continue
    const values = Array.isArray(value) ? value : [value]
    const text = values.map((v) => (Buffer.isBuffer(v) ? v.toString('hex') : String(v)))
    row[key] = text.length === 1 ? text[0] : text.join('; ')
  }
  return row
}

async function search(client: Client, cfg: ReturnType<typeof settings>, object: string, limit: number): Promise<Row[]> {
  const def = OBJECT_FILTERS[object]
  if (!def) throw new Error(`Unknown LDAP object "${object}". Use one of: ${Object.keys(OBJECT_FILTERS).join(', ')}`)
  const filter = object === 'users' ? cfg.userFilter : def.filter
  const { searchEntries } = await client.search(cfg.baseDN, {
    scope: 'sub',
    filter,
    sizeLimit: limit,
    // AD caps results per page (usually 1000); paging lets larger directories read fully.
    paged: limit > 500 ? { pageSize: 500 } : false,
    explicitBufferAttributes: BINARY_ATTRIBUTES,
  })
  return searchEntries.slice(0, limit).map((e) => toRow(e as unknown as Record<string, unknown>))
}

function friendlyError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback
  const code = (error as { code?: number } | null)?.code
  if (code === 49 || /InvalidCredentials|0x31/.test(message)) return 'LDAP bind failed: wrong bind DN or password.'
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(message)) return `LDAP server unreachable: ${message}`
  if (/SizeLimitExceeded/i.test(message)) return 'The directory refused the result size; lower max rows.'
  return message
}

export async function testLdapConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const users = await withClient(credentials, (client, cfg) => search(client, cfg, 'users', 1))
    return { ok: true, message: `Connected to the directory${users.length ? '' : ' (no users found under the base DN)'}.` }
  } catch (error) {
    return { ok: false, message: friendlyError(error, 'LDAP connection failed.') }
  }
}

export async function scanLdapSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  try {
    return await withClient(credentials, async (client, cfg) => {
      const tables = []
      for (const object of Object.keys(OBJECT_FILTERS)) {
        const rows = await search(client, cfg, object, 50).catch(() => [] as Row[])
        const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
        tables.push({
          schema: 'directory',
          name: object,
          columns: keys.map((k) => ({ name: k, type: 'TEXT', nullable: k !== 'dn' })),
          rowCount: null,
        })
      }
      return { tables, scannedAt: new Date().toISOString(), method: 'ldap' }
    })
  } catch (error) {
    throw new Error(friendlyError(error, 'LDAP schema scan failed.'))
  }
}

export async function sampleLdapObject(credentials: ConnectorCredentials, object: string, limit = 25) {
  try {
    const rows = await withClient(credentials, (client, cfg) => search(client, cfg, object, limit))
    return { tableName: object, columns: Array.from(new Set(rows.flatMap((r) => Object.keys(r)))), rows, totalRows: null as number | null }
  } catch (error) {
    throw new Error(friendlyError(error, 'LDAP read failed.'))
  }
}
