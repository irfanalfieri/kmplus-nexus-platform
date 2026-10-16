import { PATH_PLACEHOLDER, type AnswerField, type AnswerMapping, type ApiCallStep, type ApiRequestSpec, type ColumnType, type EnrichStep } from './definition'
import type { Row } from './transforms'
import { renderPath, renderRequests } from './body-template'
import { normalizeKeyPart } from './join'
import { sha256Hex } from './sha256'

/**
 * API calls inside a lane (lanes phase C). Pure and client-safe; covered by
 * scripts/engine-tests.ts. Enrich (read) and "Changes data" (write and continue)
 * build their requests here and map answers into columns; sending (rate limit,
 * retries, sign-in) is `lib/connectors/rest/call.ts`, run by the server or a
 * Nexus Agent, and the cache and call ledger live in `lib/pipelines/api-runtime.ts`.
 */

/** One HTTP request, relative to the data source's base URL. */
export interface ApiCall {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH'
  path: string
  body?: string
  contentType?: string
  headers?: Record<string, string>
}

/** What came back after retries (408/429/5xx are retried by the sender; 401/403 and redirects stop the run there). */
export interface ApiAnswer {
  status: number
  text: string
}

// ── Answers → columns ────────────────────────────────────────────────────────

/** A value at a dotted path ("data.salary", "items.0.id"); undefined when absent. */
export function getPath(obj: unknown, path: string): unknown {
  let cur = obj
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = Array.isArray(cur) && /^\d+$/.test(part) ? cur[Number(part)] : (cur as Record<string, unknown>)[part]
  }
  return cur
}

/** An answer value in the column's type (lenient: unreadable values stay as they came). */
export function answerValue(v: unknown, type: ColumnType): unknown {
  if (v === undefined || v === null || v === '') return null
  switch (type) {
    case 'integer':
    case 'numeric': {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      return Number.isFinite(n) ? (type === 'integer' ? Math.trunc(n) : n) : v
    }
    case 'boolean':
      return typeof v === 'boolean' ? v : ['true', '1', 'yes'].includes(String(v).toLowerCase()) ? true : ['false', '0', 'no'].includes(String(v).toLowerCase()) ? false : v
    case 'json':
      return v
    default:
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

const mapItem = (item: unknown, fields: AnswerField[]): Row => Object.fromEntries(fields.map((f) => [f.as, answerValue(getPath(item, f.path), f.type)]))

/** The items of an answer: the list at `listPath`, else the answer itself. */
export function answerItems(payload: unknown, mapping: Pick<AnswerMapping, 'listPath'>): unknown[] {
  if (!mapping.listPath) return payload === undefined || payload === null ? [] : Array.isArray(payload) ? payload : [payload]
  const list = getPath(payload, mapping.listPath)
  return Array.isArray(list) ? list : list === undefined || list === null ? [] : [list]
}

/** Mapped columns from answer items: one row per item (decided), the first item, or every field as a JSON list. */
export function mapItems(items: unknown[], mapping: Pick<AnswerMapping, 'listMode' | 'fields'>): Row[] {
  if (!items.length) return []
  if (mapping.listMode === 'first') return [mapItem(items[0], mapping.fields)]
  if (mapping.listMode === 'json') return [Object.fromEntries(mapping.fields.map((f) => [f.as, items.map((i) => answerValue(getPath(i, f.path), f.type))]))]
  return items.map((i) => mapItem(i, mapping.fields))
}

/** A whole answer mapped into columns (per-row calls). */
export function mapAnswer(payload: unknown, mapping: AnswerMapping): Row[] {
  return mapItems(answerItems(payload, mapping), mapping)
}

/** The lists and values of a sample answer, for the editor's picker: paths relative to the answer or to an item of a list. */
export function answerTree(sample: string): { lists: string[]; leaves: (listPath: string) => { path: string; example: string }[] } | null {
  let payload: unknown
  try {
    payload = JSON.parse(sample)
  } catch {
    return null
  }
  const lists: string[] = []
  const walkLists = (v: unknown, path: string, depth: number) => {
    if (depth > 8 || v === null || typeof v !== 'object') return
    if (Array.isArray(v)) {
      lists.push(path)
      if (v.length) walkLists(v[0], path ? `${path}.0` : '0', depth + 1)
      return
    }
    for (const [k, x] of Object.entries(v)) walkLists(x, path ? `${path}.${k}` : k, depth + 1)
  }
  walkLists(payload, '', 0)
  const leaves = (listPath: string) => {
    const out: { path: string; example: string }[] = []
    const root = listPath ? answerItems(payload, { listPath })[0] : Array.isArray(payload) ? payload[0] : payload
    const walk = (v: unknown, path: string, depth: number) => {
      if (out.length >= 300 || depth > 8) return
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1)
        return
      }
      if (path) out.push({ path, example: v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : String(v).slice(0, 80) })
    }
    walk(root, '', 0)
    return out
  }
  return { lists: lists.filter((l) => l !== '0' && !l.endsWith('.0')).map((l) => l), leaves }
}

// ── Enrich ───────────────────────────────────────────────────────────────────

/** Identifies the mapping: a changed mapping must not reuse cached answers. */
export function mappingFingerprint(step: Pick<EnrichStep, 'answer' | 'matchField' | 'normalize' | 'mode'>): string {
  const { sample: _sample, ...answer } = step.answer
  return sha256Hex(JSON.stringify({ answer, matchField: step.matchField, normalize: step.normalize, mode: step.mode })).slice(0, 16)
}

export interface EnrichRequest {
  call: ApiCall
  /** Rows answered by this request. */
  rowIndexes: number[]
  /** Batch: the normalized keys sent (each answered separately). */
  keys?: string[]
}

export interface PlannedEnrich {
  requests: EnrichRequest[]
  /** Rows that can't be asked for (no key, a path value that can't be sent …). */
  rejects: { rowIndex: number; errors: string[] }[]
  /** Rows without a key (batch modes): no match. */
  noKey: number[]
  /** Cache key per row (per-row mode) or per normalized key (batch modes). */
  cacheKeys: Map<number | string, string>
}

const callKey = (c: ApiCall) => `${c.method} ${c.path}\n${c.body ?? ''}`

/**
 * The requests for a chunk. Identical requests are sent once. Batch modes send
 * each distinct key once, `batchSize` keys per request; their cache entries are
 * per key, so a later run hits the cache whatever its batches look like.
 */
export function planEnrich(step: EnrichStep, rows: Row[], dataSourceId: string): PlannedEnrich {
  const fp = mappingFingerprint(step)
  const out: PlannedEnrich = { requests: [], rejects: [], noKey: [], cacheKeys: new Map() }
  if (step.mode === 'row') {
    const byCall = new Map<string, EnrichRequest>()
    rows.forEach((row, i) => {
      let call: ApiCall
      if (step.method === 'POST') {
        const r = renderRequests({ path: step.path, body: step.body, batchSize: 1 }, [row], { runId: 'enrich', chunk: 0 })
        if (!r.requests.length) return out.rejects.push({ rowIndex: i, errors: r.rejects[0]?.errors ?? [] })
        call = { method: 'POST', path: r.requests[0].path, body: r.requests[0].body, contentType: r.requests[0].contentType }
      } else {
        const p = renderPath(step.path, row)
        if ('error' in p) return out.rejects.push({ rowIndex: i, errors: [p.error] })
        call = { method: 'GET', path: p.path }
      }
      const k = callKey(call)
      out.cacheKeys.set(i, sha256Hex(`${dataSourceId}\n${k}\n${fp}`))
      const existing = byCall.get(k)
      if (existing) existing.rowIndexes.push(i)
      else byCall.set(k, { call, rowIndexes: [i] })
    })
    out.requests = [...byCall.values()]
    return out
  }
  // Batch: distinct keys, a representative row for each.
  const byKey = new Map<string, { raw: unknown; rows: number[] }>()
  rows.forEach((row, i) => {
    const k = normalizeKeyPart(row[step.keyColumn], step.normalize)
    if (k === null) return out.noKey.push(i)
    const entry = byKey.get(k)
    if (entry) entry.rows.push(i)
    else byKey.set(k, { raw: row[step.keyColumn], rows: [i] })
  })
  for (const k of byKey.keys()) out.cacheKeys.set(k, sha256Hex(`${dataSourceId}\n${step.method} ${step.path}?${step.queryParam}\n${step.mode === 'body' ? JSON.stringify(step.body.template) : ''}\n${k}\n${fp}`))
  const keys = [...byKey.keys()]
  for (let b = 0; b < keys.length; b += step.batchSize) {
    const slice = keys.slice(b, b + step.batchSize)
    const rowIndexes = slice.flatMap((k) => byKey.get(k)!.rows)
    if (step.mode === 'query') {
      const values = slice.map((k) => encodeURIComponent(String(byKey.get(k)!.raw).trim())).join(',')
      out.requests.push({ call: { method: step.method, path: `${step.path}${step.path.includes('?') ? '&' : '?'}${encodeURIComponent(step.queryParam)}=${values}` }, rowIndexes, keys: slice })
    } else {
      const reps = slice.map((k) => rows[byKey.get(k)!.rows[0]])
      const r = renderRequests({ path: step.path, body: step.body, batchSize: reps.length }, reps, { runId: 'enrich', chunk: 0 })
      if (!r.requests.length) {
        for (const i of rowIndexes) out.rejects.push({ rowIndex: i, errors: r.rejects[0]?.errors ?? [] })
        continue
      }
      out.requests.push({ call: { method: 'POST', path: r.requests[0].path, body: r.requests[0].body, contentType: r.requests[0].contentType }, rowIndexes, keys: slice })
    }
  }
  return out
}

/** A batch answer's items grouped by their normalized key (`matchField`), mapped into columns. */
export function matchBatchAnswer(step: EnrichStep, payload: unknown): Map<string, Row[]> {
  const groups = new Map<string, unknown[]>()
  for (const item of answerItems(payload, step.answer)) {
    const k = normalizeKeyPart(getPath(item, step.matchField), step.normalize)
    if (k !== null) groups.set(k, [...(groups.get(k) ?? []), item])
  }
  return new Map([...groups].map(([k, items]) => [k, mapItems(items, step.answer)]))
}

/**
 * What the API said about one row: its mapped items, nothing (404 or no item),
 * a refusal (other 4xx), or not asked (a test past its first calls: kept, empty).
 */
export type EnrichOutcome = { kind: 'items'; items: Row[] } | { kind: 'none' } | { kind: 'refused'; message: string } | { kind: 'skipped' }

/** Rows with their answers merged in: one row per item (rows can multiply), no match per `onNoMatch`. */
export function applyEnrich(step: EnrichStep, rows: Row[], outcomes: (EnrichOutcome | undefined)[]) {
  const out = { rows: [] as Row[], unmatched: [] as Row[], refused: [] as { row: Row; message: string }[], matched: 0, multiplied: 0 }
  const empty = Object.fromEntries(step.answer.fields.map((f) => [f.as, null]))
  rows.forEach((row, i) => {
    const o = outcomes[i] ?? { kind: 'none' as const }
    if (o.kind === 'refused') return out.refused.push({ row, message: o.message })
    if (o.kind === 'skipped') return out.rows.push({ ...row, ...empty })
    if (o.kind === 'items' && o.items.length) {
      out.matched++
      out.multiplied += o.items.length - 1
      for (const item of o.items) out.rows.push({ ...row, ...item })
      return
    }
    if (step.onNoMatch === 'quarantine') out.unmatched.push(row)
    else if (step.onNoMatch === 'keep') out.rows.push({ ...row, ...empty })
  })
  return out
}

/** Enrich chunk size: a chunk must finish well inside one worker invocation at the step's pace. */
export function enrichChunkRows(step: Pick<EnrichStep, 'mode' | 'batchSize' | 'maxRequestsPerSecond'>): number {
  const perRequest = step.mode === 'row' ? 1 : step.batchSize
  return Math.max(20, Math.min(20_000, Math.floor(step.maxRequestsPerSecond * 40 * perRequest)))
}

// ── "Changes data" ───────────────────────────────────────────────────────────

/** The record a row stands for (the call ledger's key). */
export function ledgerKey(step: Pick<ApiCallStep, 'keys'>, row: Row): string | null {
  const parts = step.keys.map((k) => (row[k] === null || row[k] === undefined ? '' : row[k] instanceof Date ? (row[k] as Date).toISOString() : String(row[k]).trim()))
  return parts.some((p) => p === '') ? null : sha256Hex(JSON.stringify(parts))
}

/** One call rendered for a row (the update request may use columns the create answer was mapped to). */
export function renderApiCall(request: ApiRequestSpec, row: Row): { call: ApiCall } | { errors: string[] } {
  const r = renderRequests({ path: request.path, body: request.body, batchSize: 1 }, [row], { runId: 'call', chunk: 0 })
  if (!r.requests.length) return { errors: r.rejects[0]?.errors ?? [] }
  const req = r.requests[0]
  const hasBody = !(request.body.template.t === 'object' && !request.body.template.fields.length)
  return { call: { method: request.method, path: req.path, body: hasBody ? req.body : undefined, contentType: hasBody ? req.contentType : undefined } }
}

/** What a row's data looks like to the API: a change here (and only here) makes a known record updated. */
export function contentHash(step: Pick<ApiCallStep, 'create'>, row: Row): string | null {
  const r = renderApiCall(step.create, row)
  return 'call' in r ? sha256Hex(callKey(r.call)).slice(0, 32) : null
}

export interface LedgerEntry {
  contentHash: string
  /** Mapped answer fields of the last successful call. */
  answer: Row
}

/**
 * Create when the ledger hasn't seen the key; update when it has, the step has
 * an update request and the row's data changed; otherwise skip (the stored
 * answer is reused, nothing is sent).
 */
export function decideCall(step: Pick<ApiCallStep, 'update'>, hash: string, entry: LedgerEntry | undefined): 'create' | 'update' | 'skip' {
  if (!entry) return 'create'
  return step.update && entry.contentHash !== hash ? 'update' : 'skip'
}

/** Sent with every call: lets an API that supports it ignore a repeat of a call it already applied. */
export function idempotencyKey(pipelineId: string, stepId: string, key: string, hash: string): string {
  return `${pipelineId}:${stepId}:${key.slice(0, 16)}:${hash.slice(0, 16)}`
}

/** Columns a "Changes data" step reads from a row (for the editor's warnings). */
export function apiCallColumns(step: Pick<ApiCallStep, 'create' | 'update'>): string[] {
  const names = new Set<string>()
  for (const r of [step.create, ...(step.update ? [step.update] : [])]) for (const m of r.path.matchAll(new RegExp(PATH_PLACEHOLDER.source, 'g'))) names.add(m[1])
  return [...names]
}
