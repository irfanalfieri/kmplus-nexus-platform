import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult, SchemaTable } from '../types'

function basicAuthHeader(username: string, password: string) {
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

function normalizeBaseUrl(host: string) {
  return host.trim().replace(/\/+$/, '')
}

export async function testSapConnection(credentials: ConnectorCredentials): Promise<ConnectionTestResult> {
  const host = credentials.host?.trim()
  const username = credentials.username?.trim()
  const password = credentials.password ?? ''
  if (!host || !username) return { ok: false, message: 'SAP OData base URL and username are required.' }

  try {
    const response = await fetch(`${normalizeBaseUrl(host)}/$metadata`, {
      headers: {
        Authorization: basicAuthHeader(username, password),
        Accept: 'application/xml',
      },
      cache: 'no-store',
    })

    if (response.status === 401 || response.status === 403) {
      return { ok: false, message: 'SAP authentication failed.' }
    }
    if (!response.ok) {
      return { ok: false, message: `SAP OData service returned status ${response.status}.` }
    }
    return { ok: true, message: 'Connected to SAP OData service.' }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : 'SAP OData unreachable.' }
  }
}

export async function scanSapSchema(credentials: ConnectorCredentials): Promise<SchemaScanResult> {
  const host = credentials.host?.trim()
  const username = credentials.username?.trim()
  const password = credentials.password ?? ''
  if (!host || !username) throw new Error('SAP credentials incomplete.')

  const response = await fetch(`${normalizeBaseUrl(host)}/$metadata`, {
    headers: {
      Authorization: basicAuthHeader(username, password),
      Accept: 'application/xml',
    },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`SAP metadata fetch failed (${response.status}).`)

  const xml = await response.text()
  const entitySets = [...xml.matchAll(/EntitySet Name="([^"]+)"/g)].map((m) => m[1])
  const entityTypes = [...xml.matchAll(/EntityType Name="([^"]+)"/g)].map((m) => m[1])

  const tables: SchemaTable[] = entitySets.map((name) => {
    const typeBlock = xml.match(new RegExp(`EntityType Name="${name}"[\\s\\S]*?<\\/EntityType>`, 'i'))
    const properties = typeBlock
      ? [...typeBlock[0].matchAll(/Property Name="([^"]+)" Type="([^"]+)"/g)].map((m) => ({
          name: m[1],
          type: m[2].split('.').pop()?.toUpperCase() ?? 'TEXT',
          nullable: true,
        }))
      : []

    return {
      schema: 'odata',
      name,
      columns: properties,
      rowCount: null,
    }
  })

  if (!tables.length && entityTypes.length) {
    for (const name of entityTypes.slice(0, 20)) {
      tables.push({ schema: 'odata', name, columns: [], rowCount: null })
    }
  }

  return { tables, scannedAt: new Date().toISOString(), method: 'sap-odata-metadata' }
}

export async function sampleSapEntity(
  credentials: ConnectorCredentials,
  entitySet: string,
  limit = 25
) {
  const host = credentials.host?.trim()
  const username = credentials.username?.trim()
  const password = credentials.password ?? ''
  const url = `${normalizeBaseUrl(host!)}/${encodeURIComponent(entitySet)}?$top=${limit}&$format=json`

  const response = await fetch(url, {
    headers: {
      Authorization: basicAuthHeader(username!, password),
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`SAP entity fetch failed (${response.status}).`)

  const payload = await response.json()
  const rows = (payload?.d?.results ?? payload?.value ?? []) as Record<string, unknown>[]
  return {
    tableName: entitySet,
    columns: rows.length ? Object.keys(rows[0]) : [],
    rows,
    totalRows: rows.length,
  }
}
