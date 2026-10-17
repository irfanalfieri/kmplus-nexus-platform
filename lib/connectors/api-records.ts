import { parseXml } from '@/lib/pipelines/body-template'
import { flattenRow, type Row } from './http'

/**
 * GraphQL and SOAP sources (DS-9): operations written by the user and the
 * records found in their answers. Pure; covered by scripts/engine-tests.ts.
 * Drivers: lib/connectors/drivers/graphql.ts and soap.ts.
 */

export interface ApiOperation {
  /** Table name (lower case, letters, digits, _). */
  name: string
  body: string
}

const tableName = (raw: string) => raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')

/**
 * Operations, each under a `### name` line (several lines each, so whole
 * GraphQL queries and SOAP envelopes fit). Without headers, the text is one
 * operation named `fallback`.
 */
export function parseOperations(raw: string | undefined, fallback = 'result'): ApiOperation[] {
  const text = (raw ?? '').replace(/\r\n/g, '\n')
  const out: ApiOperation[] = []
  const parts = text.split(/^###[ \t]*(.+)$/m)
  if (parts.length === 1) return text.trim() ? [{ name: fallback, body: text.trim() }] : []
  for (let i = 1; i < parts.length; i += 2) {
    const name = tableName(parts[i])
    const body = (parts[i + 1] ?? '').trim()
    if (name && body && !out.some((o) => o.name === name)) out.push({ name, body })
  }
  return out
}

// ── GraphQL ──────────────────────────────────────────────────────────────────

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * The records of a GraphQL answer: the first list of objects under `data`
 * (breadth first, so `employees.nodes` or `employees.edges[].node` is found),
 * and the `pageInfo` next to it for cursor paging.
 */
export function graphqlRecords(data: unknown): { rows: Row[]; path: string; pageInfo: { hasNextPage: boolean; endCursor: string | null } | null } {
  const queue: { value: unknown; path: string; parent: Record<string, unknown> | null }[] = [{ value: data, path: '', parent: null }]
  while (queue.length) {
    const { value, path, parent } = queue.shift()!
    if (Array.isArray(value)) {
      if (value.length === 0 || value.every(isObj)) {
        // Relay connections: edges[].node are the records.
        const rows = (value as Record<string, unknown>[]).map((v) => (isObj(v.node) && Object.keys(v).every((k) => k === 'node' || k === 'cursor') ? v.node : v))
        const info = parent && isObj(parent.pageInfo) ? parent.pageInfo : null
        return {
          rows: rows.map((r) => flattenRow(r as Row)),
          path,
          pageInfo: info ? { hasNextPage: info.hasNextPage === true, endCursor: typeof info.endCursor === 'string' ? info.endCursor : null } : null,
        }
      }
      continue
    }
    if (isObj(value)) for (const [k, v] of Object.entries(value)) if (k !== 'pageInfo') queue.push({ value: v, path: path ? `${path}.${k}` : k, parent: value })
  }
  // A single object answer is one row.
  const first = isObj(data) ? Object.values(data).find(isObj) : null
  return { rows: first ? [flattenRow(first as Row)] : [], path: '', pageInfo: null }
}

/** Whether the query takes a cursor (`$after`), so pages can be requested. */
export const graphqlPaged = (query: string) => /\$after\b/.test(query)

/** The GraphQL error messages of an answer, joined. */
export function graphqlErrors(body: unknown): string | null {
  if (!isObj(body) || !Array.isArray(body.errors) || !body.errors.length) return null
  return (body.errors as { message?: unknown }[]).map((e) => String(e?.message ?? 'error')).slice(0, 3).join('; ')
}

// ── SOAP ─────────────────────────────────────────────────────────────────────

type XmlElement = ReturnType<typeof parseXml>
const local = (name: string) => name.slice(name.indexOf(':') + 1)

function* walk(el: XmlElement): Generator<XmlElement> {
  yield el
  for (const c of el.children) yield* walk(c)
}

function elementRow(el: XmlElement, prefix = '', out: Row = {}): Row {
  for (const [k, v] of el.attrs) if (!k.startsWith('xmlns') && !k.includes(':')) out[`${prefix}@${k}`] = v
  for (const c of el.children) {
    const key = `${prefix}${local(c.name)}`
    if (c.children.length) elementRow(c, `${key}.`, out)
    else if (key in out) out[key] = `${out[key]}, ${c.text.trim()}`
    else out[key] = c.text.trim() === '' ? null : c.text.trim()
  }
  return out
}

/**
 * The records of a SOAP answer: elements named `recordElement` (local name,
 * any namespace) or, without it, the repeated element with child elements that
 * occurs most often in the Body. A SOAP Fault becomes an error.
 */
export function soapRecords(xml: string, recordElement?: string): { rows: Row[]; element: string | null } {
  const root = parseXml(xml)
  const body = [...walk(root)].find((e) => local(e.name) === 'Body') ?? root
  const fault = [...walk(body)].find((e) => local(e.name) === 'Fault')
  if (fault) {
    const text = [...walk(fault)].find((e) => ['faultstring', 'Text', 'Reason'].includes(local(e.name)) && e.text.trim())?.text.trim()
    throw Object.assign(new Error(`The SOAP service returned a fault: ${text ?? 'no message'}`), { retryable: false })
  }
  let name = recordElement?.trim() ? local(recordElement.trim()) : null
  if (!name) {
    const counts = new Map<string, number>()
    for (const e of walk(body)) if (e !== body && e.children.length) counts.set(local(e.name), (counts.get(local(e.name)) ?? 0) + 1)
    const repeated = [...counts].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1])
    // One record (no repeats): the deepest element that has only leaf children.
    name = repeated[0]?.[0] ?? [...walk(body)].filter((e) => e.children.length && e.children.every((c) => !c.children.length)).pop()?.name ?? null
    if (name) name = local(name)
  }
  if (!name) return { rows: [], element: null }
  const els = [...walk(body)].filter((e) => local(e.name) === name)
  // Records inside records (an element of the same name nested in one) stay part of the outer record.
  const top = els.filter((e) => !els.some((o) => o !== e && [...walk(o)].includes(e)))
  return { rows: top.map((e) => elementRow(e)), element: name }
}
