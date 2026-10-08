import type { ConnectionTestResult, ConnectorCredentials, SchemaScanResult } from '../types'
import { resolveSalesforceAuth, SF_API_VERSION } from '../salesforce/oauth'

export async function testSalesforceConnection(
  credentials: ConnectorCredentials
): Promise<ConnectionTestResult> {
  try {
    const auth = await resolveSalesforceAuth(credentials)
    const response = await fetch(`${auth.instance_url}/services/data/${SF_API_VERSION}/`, {
      headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!response.ok) {
      return { ok: false, message: `Salesforce API returned ${response.status}.` }
    }
    return {
      ok: true,
      message: `Connected to Salesforce (${auth.instance_url}).`,
      meta: { instanceUrl: auth.instance_url },
    }
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Salesforce connection failed.',
    }
  }
}

export async function scanSalesforceSchema(
  credentials: ConnectorCredentials
): Promise<SchemaScanResult> {
  const auth = await resolveSalesforceAuth(credentials)
  const response = await fetch(`${auth.instance_url}/services/data/${SF_API_VERSION}/sobjects`, {
    headers: { Authorization: `Bearer ${auth.access_token}`, Accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Salesforce schema fetch failed (${response.status}).`)

  const payload = await response.json()
  const sobjects = (payload?.sobjects ?? []) as Array<{
    name: string
    queryable: boolean
    label: string
  }>

  const tables = await Promise.all(
    sobjects
      .filter((s) => s.queryable)
      .slice(0, 50)
      .map(async (sobject) => {
        const describeRes = await fetch(
          `${auth.instance_url}/services/data/${SF_API_VERSION}/sobjects/${sobject.name}/describe`,
          {
            headers: { Authorization: `Bearer ${auth.access_token}` },
            cache: 'no-store',
          }
        )
        if (!describeRes.ok) {
          return {
            schema: 'salesforce',
            name: sobject.name,
            columns: [],
            rowCount: null,
          }
        }
        const describe = await describeRes.json()
        return {
          schema: 'salesforce',
          name: sobject.name,
          columns: ((describe.fields ?? []) as Array<{ name: string; type: string; nillable: boolean }>).map(
            (field) => ({
              name: field.name,
              type: field.type.toUpperCase(),
              nullable: field.nillable,
            })
          ),
          rowCount: null,
        }
      })
  )

  return {
    tables: tables.sort((a, b) => a.name.localeCompare(b.name)),
    scannedAt: new Date().toISOString(),
    method: 'salesforce-describe',
  }
}

export async function sampleSalesforceObject(
  credentials: ConnectorCredentials,
  objectName: string,
  limit = 25
) {
  const auth = await resolveSalesforceAuth(credentials)
  const url = `${auth.instance_url}/services/data/${SF_API_VERSION}/query?q=${encodeURIComponent(`SELECT FIELDS(STANDARD) FROM ${objectName} LIMIT ${limit}`)}`
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.access_token}` },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Salesforce query failed (${response.status}).`)

  const payload = await response.json()
  const rows = (payload?.records ?? []) as Record<string, unknown>[]
  const cleaned = rows.map(({ attributes, ...rest }) => rest)
  return {
    tableName: objectName,
    columns: cleaned.length ? Object.keys(cleaned[0]) : [],
    rows: cleaned,
    totalRows: payload?.totalSize ?? cleaned.length,
  }
}
