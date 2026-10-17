import type { ConnectorCredentials, ConnectionTestResult, SchemaScanResult } from '../types'
import { baseUrlOf, configError, inferColumns, request, sampleResult, scanResult, type Row } from '../http'
import { parseOperations, soapRecords } from '../api-records'

/**
 * SOAP web services (DS-9), read-only: each request envelope the user pastes
 * (under a `### name` line, with an optional `SOAPAction: …` first line) is a
 * table; the repeated element of the answer (or the one named in "Record
 * element") gives the rows. SOAP 1.1 and 1.2; faults become errors.
 */

function settings(c: ConnectorCredentials) {
  const endpoint = baseUrlOf(c.endpoint, 'The SOAP endpoint')
  const version = c.soapVersion === '1.2' ? '1.2' : '1.1'
  const auth: Record<string, string> = {}
  if (c.username) auth.authorization = `Basic ${Buffer.from(`${c.username}:${c.password ?? ''}`).toString('base64')}`
  const name = c.authHeader?.trim()
  if (name) {
    if (!/^[A-Za-z0-9-]{1,60}$/.test(name)) throw configError('The sign-in header name may only contain letters, digits and hyphens.')
    auth[name.toLowerCase()] = c.authValue ?? ''
  }
  const ops = parseOperations(c.operations, 'result').map((o) => {
    const m = /^SOAPAction:\s*(.*)\n/i.exec(`${o.body}\n`)
    return { name: o.name, action: m ? m[1].trim().replace(/^"|"$/g, '') : '', envelope: m ? o.body.slice(m[0].length - 1).trim() : o.body }
  })
  return { endpoint, version, auth, ops, recordElement: c.recordElement?.trim() || undefined }
}

async function call(c: ConnectorCredentials, op: { action: string; envelope: string }) {
  const s = settings(c)
  const headers: Record<string, string> =
    s.version === '1.2'
      ? { 'content-type': `application/soap+xml; charset=utf-8${op.action ? `; action="${op.action}"` : ''}` }
      : { 'content-type': 'text/xml; charset=utf-8', soapaction: `"${op.action}"` }
  const res = await request('SOAP service', s.endpoint, { method: 'POST', headers: { ...headers, ...s.auth, accept: 'text/xml, application/soap+xml' }, body: op.envelope, timeoutMs: 60_000 })
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw configError(`The SOAP service rejected the sign-in (HTTP ${res.status}).`)
  // Faults come back as HTTP 500 with a Fault element: soapRecords turns them into a readable error.
  if (!/^\s*</.test(text)) throw Object.assign(new Error(`The SOAP service did not answer with XML (HTTP ${res.status}).`), { retryable: res.status >= 500 })
  try {
    return soapRecords(text, s.recordElement)
  } catch (err) {
    if ((err as { retryable?: boolean }).retryable === false) throw err
    throw configError(`The SOAP answer could not be read: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function rows(c: ConnectorCredentials, table: string, max: number): Promise<Row[]> {
  const op = settings(c).ops.find((o) => o.name === table)
  if (!op) throw configError(`No operation "${table}". Test the data source again to refresh its tables.`)
  return (await call(c, op)).rows.slice(0, max)
}

export async function testSoapConnection(c: ConnectorCredentials): Promise<ConnectionTestResult> {
  try {
    const s = settings(c)
    if (!s.ops.length) return { ok: false, message: 'Paste at least one request envelope (under a line ### name).' }
    const first = await call(c, s.ops[0])
    return { ok: true, message: `Connected to the SOAP service. Records from “${s.ops[0].name}”: ${first.rows.length}.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'SOAP connection failed.' }
  }
}

export async function scanSoapSchema(c: ConnectorCredentials): Promise<SchemaScanResult> {
  const s = settings(c)
  const tables = []
  for (const op of s.ops) tables.push({ schema: 'soap', name: op.name, columns: inferColumns(await rows(c, op.name, 50).catch(() => [])), rowCount: null })
  return scanResult(tables, 'soap-operations')
}

export async function sampleSoapTable(c: ConnectorCredentials, table: string, limit = 25) {
  return sampleResult(table, await rows(c, table, limit), limit)
}

export const readSoapRows = (c: ConnectorCredentials, table: string, maxRows: number) => rows(c, table, maxRows)
