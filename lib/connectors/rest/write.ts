import { connectorFetch } from '@/lib/net/safe-url'
import { buildRestWriteBase, parseRestConfig, redactRestRequest, type RestRequestPreview } from '@/lib/connectors/rest-client'
import type { ConnectorCredentials } from '@/lib/connectors/types'
import {
  API_MAX_ATTEMPTS,
  classifyStatus,
  extractRejectedItems,
  renderRequests,
  retryAfterMs,
  retryDelayMs,
  shortApiMessage,
  type RenderedRequest,
} from '@/lib/pipelines/body-template'
import { checkText } from '@/lib/pipelines/check-messages'
import { PATH_PLACEHOLDER, type ApiDestinationSpec } from '@/lib/pipelines/definition'
import type { Row } from '@/lib/pipelines/conditions'

/**
 * Writes rows to a REST API (pipeline destination step, server and Nexus Agent).
 * The body comes from the step's template (lib/pipelines/body-template.ts);
 * sign-in, headers, variables and network settings from the data source.
 *
 * 2xx: written (minus items the response lists as refused). Other 4xx: those
 * rows go to the quarantine with a short, redacted reason. 408/429/5xx and
 * network errors: retried with backoff, honouring Retry-After; still failing,
 * the chunk fails and the run retries from its last checkpoint. 401/403,
 * redirects and a path that is missing for every request stop the run.
 * Request bodies are never logged: they hold personal data.
 */

export interface ApiWriteOptions {
  runId?: string
  chunk?: number
  /** Position of the first row within its chunk (stable batch numbers across agent calls). */
  rowOffset?: number
  /** Epoch ms: stop before this (the worker's function time limit). */
  deadline?: number
}

export interface ApiWriteResult {
  written: number
  rejected: { row: Row; error: string; errors?: string[] }[]
}

const fatal = (message: string) => Object.assign(new Error(message), { retryable: false })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One request per slot: at most `perSecond` starts per second across all workers. */
function rateLimiter(perSecond: number) {
  const gap = 1000 / Math.max(0.1, perSecond)
  let next = 0
  return async () => {
    const now = Date.now()
    const at = Math.max(now, next)
    next = at + gap
    if (at > now) await sleep(at - now)
  }
}

async function readText(res: Response) {
  const text = await res.text().catch(() => '')
  return text.length > 1_000_000 ? text.slice(0, 1_000_000) : text
}

export async function writeRestApi(credentials: ConnectorCredentials, spec: ApiDestinationSpec, rows: Row[], opts: ApiWriteOptions = {}): Promise<ApiWriteResult> {
  const rendered = renderRequests(spec, rows, { runId: opts.runId ?? 'adhoc', chunk: opts.chunk ?? 0, rowOffset: opts.rowOffset })
  const rejected: ApiWriteResult['rejected'] = rendered.rejects.map((r) => ({ row: rows[r.rowIndex], error: r.errors.join('; '), errors: r.errors }))
  if (!rendered.requests.length) return { written: 0, rejected }

  const base = await buildRestWriteBase(parseRestConfig(credentials))
  const slot = rateLimiter(spec.maxRequestsPerSecond)
  const queue = [...rendered.requests]
  let written = 0
  let notFound = 0
  let stop: Error | null = null

  const send = async (req: RenderedRequest) => {
    const url = base.url(req.path)
    const headers = { ...base.headers }
    base.header(headers, 'Content-Type', req.contentType)
    if (spec.idempotencyKey) base.header(headers, spec.idempotencyHeader, req.batchId)
    for (let attempt = 1; ; attempt++) {
      if (stop) return
      if (opts.deadline && Date.now() > opts.deadline) throw new Error('Stopped sending to the API before the worker time limit; the run continues from its last checkpoint.')
      await slot()
      let res: Response
      try {
        res = await connectorFetch(url, { method: spec.method, headers, body: req.body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(spec.timeoutSeconds * 1000) }, base.network)
      } catch (err) {
        if ((err as { retryable?: boolean })?.retryable === false) throw err
        if (attempt >= API_MAX_ATTEMPTS) throw new Error(`The API did not answer after ${attempt} attempts (${err instanceof Error ? err.message : 'network error'}).`)
        await sleep(retryDelayMs(attempt, null))
        continue
      }
      const status = res.status
      const kind = classifyStatus(status)
      if (kind === 'retry') {
        await res.body?.cancel().catch(() => undefined)
        if (attempt >= API_MAX_ATTEMPTS) throw new Error(`The API answered HTTP ${status} after ${attempt} attempts.`)
        const wait = retryDelayMs(attempt, retryAfterMs(res.headers.get('retry-after')))
        if (opts.deadline && Date.now() + wait > opts.deadline) throw new Error('Stopped sending to the API before the worker time limit; the run continues from its last checkpoint.')
        await sleep(wait)
        continue
      }
      if (kind === 'signin') throw fatal(`The API refused Nexus's sign-in (HTTP ${status}). Check the destination data source's credentials and permissions.`)
      if (kind === 'redirect') throw fatal(`The API answered with a redirect (HTTP ${status}). Use the final address as the data source's base URL.`)
      const text = await readText(res)
      if (kind === 'reject') {
        if (status === 404) notFound++
        const error = checkText('apiRefused', { status, message: shortApiMessage(text) })
        for (const i of req.rowIndexes) rejected.push({ row: rows[i], error })
        return
      }
      // 2xx: items the API lists as refused go to the quarantine; the rest are written.
      let refused: { index: number; message: string }[] = []
      if (spec.response.rejectedPath && text) {
        try {
          refused = extractRejectedItems(JSON.parse(text), spec.response, req.rowIndexes.length)
        } catch {
          /* not JSON: nothing listed */
        }
      }
      for (const r of refused) rejected.push({ row: rows[req.rowIndexes[r.index]], error: checkText('apiItemRejected', { message: r.message }) })
      written += req.rowIndexes.length - refused.length
      return
    }
  }

  const worker = async () => {
    while (!stop && queue.length) {
      const req = queue.shift()!
      try {
        await send(req)
      } catch (err) {
        stop ??= err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(spec.concurrency, queue.length) }, worker))
  if (stop) throw stop

  // The same 404 for every request means the path itself is wrong, not the rows.
  const total = rendered.requests.length
  const perRowPath = new RegExp(PATH_PLACEHOLDER.source).test(spec.path)
  if (notFound === total && (!perRowPath || total >= 5)) {
    throw fatal(`Every request to ${spec.method} ${spec.path} got HTTP 404 (not found). Check the path in the destination step.`)
  }
  return { written, rejected }
}

/**
 * Test for a REST data source added as a destination: sign in and reach the
 * API. A write-only API may answer a GET with 404 or 405, which still proves
 * the address and network path; only no answer, a refused sign-in or a
 * redirect fail. The write itself is tried with "Send test request" in the
 * pipeline's Destination step.
 */
export async function testRestDestination(credentials: ConnectorCredentials): Promise<{ ok: boolean; message: string }> {
  try {
    const config = parseRestConfig(credentials)
    const base = await buildRestWriteBase(config)
    const url = base.url(config.resourcePath || '/')
    const res = await connectorFetch(url, { method: 'GET', headers: base.headers, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000) }, base.network)
    await res.body?.cancel().catch(() => undefined)
    const kind = classifyStatus(res.status)
    if (kind === 'signin') return { ok: false, message: `The API refused Nexus's sign-in (HTTP ${res.status}). Check the destination data source's credentials and permissions.` }
    if (kind === 'redirect') return { ok: false, message: `The API answered with a redirect (HTTP ${res.status}). Use the final address as the data source's base URL.` }
    return { ok: true, message: `Reached ${new URL(url).origin} (HTTP ${res.status}). Writes are tried with Send test request in a pipeline's Destination step.` }
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Connection failed' }
  }
}

export interface ApiTestResult {
  request: RestRequestPreview['request']
  response: { status: number; statusText: string; durationMs: number; contentType: string; headers: Record<string, string>; bodyPreview: string } | null
  /** Why the row couldn't be turned into a request. */
  renderErrors: string[]
  /** What a run would do with the row. */
  outcome: 'written' | 'rejected' | 'retry' | 'signin' | 'redirect' | 'not_sent'
  message: string
}

const SHOWN_RESPONSE_HEADERS = ['content-type', 'content-length', 'location', 'retry-after', 'x-request-id', 'x-ratelimit-remaining', 'x-ratelimit-limit']

/**
 * "Send test request" in the editor: one row, one attempt, no retries. Returns
 * the request with sign-in masked and the API's answer (shown to the person
 * testing; never logged).
 */
export async function sendRestTestRequest(credentials: ConnectorCredentials, spec: ApiDestinationSpec, row: Row): Promise<ApiTestResult> {
  const config = parseRestConfig(credentials)
  const rendered = renderRequests({ ...spec, batchSize: 1 }, [row], { runId: 'test', chunk: 0 })
  const req = rendered.requests[0]
  if (!req) {
    const errors = rendered.rejects[0]?.errors ?? []
    return { request: { method: spec.method, url: spec.path, headers: {} }, response: null, renderErrors: errors, outcome: 'not_sent', message: errors.join('; ') }
  }
  const base = await buildRestWriteBase(config)
  const url = base.url(req.path)
  const headers = { ...base.headers }
  base.header(headers, 'Content-Type', req.contentType)
  if (spec.idempotencyKey) base.header(headers, spec.idempotencyHeader, req.batchId)
  const request = redactRestRequest({ method: spec.method, url, headers, bodyPreview: req.body.slice(0, 20_000) }, config)
  const started = Date.now()
  const res = await connectorFetch(url, { method: spec.method, headers, body: req.body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(spec.timeoutSeconds * 1000) }, base.network)
  const text = await readText(res)
  const kind = classifyStatus(res.status)
  let outcome: ApiTestResult['outcome'] = kind === 'ok' ? 'written' : kind === 'reject' ? 'rejected' : kind
  let message = kind === 'reject' ? checkText('apiRefused', { status: res.status, message: shortApiMessage(text) }) : ''
  if (kind === 'ok' && spec.response.rejectedPath) {
    try {
      const refused = extractRejectedItems(JSON.parse(text), spec.response, 1)
      if (refused.length) {
        outcome = 'rejected'
        message = checkText('apiItemRejected', { message: refused[0].message })
      }
    } catch {
      /* not JSON */
    }
  }
  return {
    request,
    response: {
      status: res.status,
      statusText: res.statusText,
      durationMs: Date.now() - started,
      contentType: res.headers.get('content-type') ?? '',
      headers: Object.fromEntries(SHOWN_RESPONSE_HEADERS.flatMap((h) => (res.headers.get(h) ? [[h, res.headers.get(h)!]] : []))),
      bodyPreview: text.slice(0, 4000),
    },
    renderErrors: [],
    outcome,
    message,
  }
}
