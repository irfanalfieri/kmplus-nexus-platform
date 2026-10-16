import { connectorFetch } from '@/lib/net/safe-url'
import { buildRestWriteBase, parseRestConfig, redactRestRequest, type RestRequestPreview } from '@/lib/connectors/rest-client'
import type { ConnectorCredentials } from '@/lib/connectors/types'
import { API_MAX_ATTEMPTS, classifyStatus, retryAfterMs, retryDelayMs } from '@/lib/pipelines/body-template'
import type { ApiAnswer, ApiCall } from '@/lib/pipelines/api-calls'

/**
 * Sends API calls for Enrich and "Changes data" steps (server and Nexus Agent):
 * the data source supplies base URL, sign-in, headers, variables and network
 * settings (as for REST destinations, `buildRestWriteBase`); every URL stays
 * under the base URL. 408/429/5xx and network errors are retried with backoff
 * (Retry-After honoured), then the chunk fails and the run retries from its
 * checkpoint; 401/403 and redirects stop the run. Every other answer (2xx, 404,
 * other 4xx) is returned for the step to interpret. Bodies are never logged.
 *
 * A failure doesn't lose the answers already received: they come back with the
 * error, so a "Changes data" step records every call that went through before
 * the run stops or retries.
 */

export interface CallsResult {
  /** In call order; undefined for calls not sent or not answered. */
  answers: (ApiAnswer | undefined)[]
  error?: { message: string; retryable: boolean }
}

export interface CallOptions {
  maxRequestsPerSecond: number
  concurrency: number
  timeoutSeconds: number
  /** Epoch ms: stop before this (the worker's function time limit). */
  deadline?: number
}

const fatal = (message: string) => Object.assign(new Error(message), { retryable: false })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const LATE = 'Stopped calling the API before the worker time limit; the run continues from its last checkpoint.'

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
  return text.length > 2_000_000 ? text.slice(0, 2_000_000) : text
}

/** Answers in the order of the calls, and the error that stopped them, if any. */
export async function sendRestCalls(credentials: ConnectorCredentials, calls: ApiCall[], opts: CallOptions): Promise<CallsResult> {
  if (!calls.length) return { answers: [] }
  const base = await buildRestWriteBase(parseRestConfig(credentials))
  const slot = rateLimiter(opts.maxRequestsPerSecond)
  const answers: (ApiAnswer | undefined)[] = new Array(calls.length).fill(undefined)
  let next = 0
  let stop: Error | null = null

  const send = async (call: ApiCall): Promise<ApiAnswer> => {
    const url = base.url(call.path)
    const headers = { ...base.headers }
    if (call.contentType) base.header(headers, 'Content-Type', call.contentType)
    for (const [k, v] of Object.entries(call.headers ?? {})) base.header(headers, k, v)
    for (let attempt = 1; ; attempt++) {
      if (stop) throw stop
      if (opts.deadline && Date.now() > opts.deadline) throw new Error(LATE)
      await slot()
      let res: Response
      try {
        res = await connectorFetch(url, { method: call.method, headers, body: call.body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(opts.timeoutSeconds * 1000) }, base.network)
      } catch (err) {
        if ((err as { retryable?: boolean })?.retryable === false) throw err
        if (attempt >= API_MAX_ATTEMPTS) throw new Error(`The API did not answer after ${attempt} attempts (${err instanceof Error ? err.message : 'network error'}).`)
        await sleep(retryDelayMs(attempt, null))
        continue
      }
      const kind = classifyStatus(res.status)
      if (kind === 'retry') {
        await res.body?.cancel().catch(() => undefined)
        if (attempt >= API_MAX_ATTEMPTS) throw new Error(`The API answered HTTP ${res.status} after ${attempt} attempts.`)
        const wait = retryDelayMs(attempt, retryAfterMs(res.headers.get('retry-after')))
        if (opts.deadline && Date.now() + wait > opts.deadline) throw new Error(LATE)
        await sleep(wait)
        continue
      }
      if (kind === 'signin') throw fatal(`The API refused Nexus's sign-in (HTTP ${res.status}). Check the data source's credentials and permissions.`)
      if (kind === 'redirect') throw fatal(`The API answered with a redirect (HTTP ${res.status}). Use the final address as the data source's base URL.`)
      return { status: res.status, text: await readText(res) }
    }
  }

  const worker = async () => {
    while (!stop && next < calls.length) {
      const i = next++
      try {
        answers[i] = await send(calls[i])
      } catch (err) {
        stop ??= err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, opts.concurrency), calls.length) }, worker))
  const failed = stop as Error | null
  return failed ? { answers, error: { message: failed.message, retryable: (failed as { retryable?: boolean }).retryable !== false } } : { answers }
}

/** One test call from the editor (one attempt, no retries): the request with sign-in masked, and the answer. */
export async function sendRestTestCall(credentials: ConnectorCredentials, call: ApiCall, timeoutSeconds: number): Promise<{ request: RestRequestPreview['request']; status: number; durationMs: number; text: string }> {
  const config = parseRestConfig(credentials)
  const base = await buildRestWriteBase(config)
  const url = base.url(call.path)
  const headers = { ...base.headers }
  if (call.contentType) base.header(headers, 'Content-Type', call.contentType)
  for (const [k, v] of Object.entries(call.headers ?? {})) base.header(headers, k, v)
  const request = redactRestRequest({ method: call.method, url, headers, bodyPreview: (call.body ?? '').slice(0, 20_000) }, config)
  const started = Date.now()
  const res = await connectorFetch(url, { method: call.method, headers, body: call.body, redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(timeoutSeconds * 1000) }, base.network)
  return { request, status: res.status, durationMs: Date.now() - started, text: (await readText(res)).slice(0, 50_000) }
}
