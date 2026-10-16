import { and, eq, gt, inArray, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { apiCallCache, apiCallLedger } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { DEFAULT_MAX_CALLS, type ApiCallStep, type EnrichStep } from './definition'
import { checkText } from './check-messages'
import { shortApiMessage } from './body-template'
import {
  contentHash,
  decideCall,
  idempotencyKey,
  ledgerKey,
  mapAnswer,
  matchBatchAnswer,
  planEnrich,
  renderApiCall,
  type ApiAnswer,
  type ApiCall,
  type EnrichOutcome,
  type LedgerEntry,
} from './api-calls'
import { NonRetryableError, sendApiCalls, type StoredDataSource } from './io'
import type { Row } from './transforms'
import { sha256Hex } from './sha256'
import { normalizeKeyPart } from './join'

/**
 * Runs Enrich and "Changes data" steps for the engine (`EngineContext.api`):
 * the cross-run cache (Enrich), the per-run call cap, the call ledger
 * ("Changes data"), and sending through the server or a Nexus Agent. Server
 * only. Test runs call Enrich for their first few requests only, never send a
 * "Changes data" call, and never write the cache or the ledger.
 */

/** Calls a sample test sends for each Enrich step. */
export const TEST_ENRICH_CALLS = 5
const NOT_FOUND_HOURS = 1

export interface ApiStepResult<O> {
  outcomes: O[]
  /** Requests sent, and rows answered from the cache. */
  calls: number
  cached: number
}

export type ApiCallOutcome = { kind: 'ok'; answer: Row; sent: boolean } | { kind: 'refused'; message: string }

export interface ApiRuntime {
  enrich(step: EnrichStep, rows: Row[]): Promise<ApiStepResult<EnrichOutcome>>
  call(step: ApiCallStep, rows: Row[]): Promise<ApiStepResult<ApiCallOutcome>>
}

const seal = (id: string, workspaceId: string, value: unknown) => encryptCredentials(id, { v: value } as Record<string, unknown>, workspaceId)
const open = (id: string, stored: unknown) => (decryptCredentials(id, stored) as { v?: unknown }).v

export function apiRuntime(opts: {
  workspaceId: string
  /** Saved pipeline (cache and ledger are per step of a pipeline); null for an unsaved test. */
  pipelineId: string | null
  mode: 'run' | 'test'
  loadSource: (id: string) => Promise<StoredDataSource>
  /** Calls made so far this run, per step (persisted with the run's progress). */
  counters: Record<string, number>
  deadline?: number
}): ApiRuntime {
  const testing = opts.mode === 'test'
  const testCalls = new Map<string, number>()

  const cap = async (step: { id: string; dataSourceId: string }, source: StoredDataSource, adding: number) => {
    const max = Number((source.config as { maxCallsPerRun?: number } | null)?.maxCallsPerRun) || DEFAULT_MAX_CALLS
    const used = (opts.counters[step.id] ?? 0) + adding
    if (used > max) throw new NonRetryableError(`This run would make more than ${max.toLocaleString('en-US')} calls to "${source.name}". An admin can raise the limit for that data source, or filter the rows first.`)
    opts.counters[step.id] = used
  }

  const send = async (step: { id: string; dataSourceId: string; maxRequestsPerSecond: number; concurrency: number; timeoutSeconds: number }, calls: ApiCall[], writes: boolean) => {
    const source = await opts.loadSource(step.dataSourceId)
    await cap(step, source, calls.length)
    return sendApiCalls(source, calls, { maxRequestsPerSecond: step.maxRequestsPerSecond, concurrency: step.concurrency, timeoutSeconds: step.timeoutSeconds, deadline: opts.deadline, writes })
  }

  const parse = (a: ApiAnswer): { ok: true; payload: unknown } | { ok: false; message: string } => {
    if (!a.text.trim()) return { ok: true, payload: null }
    try {
      return { ok: true, payload: JSON.parse(a.text) }
    } catch {
      return { ok: false, message: checkText('apiRefused', { status: a.status, message: 'the answer is not JSON' }) }
    }
  }
  const refusal = (a: ApiAnswer) => checkText('apiRefused', { status: a.status, message: shortApiMessage(a.text) })

  return {
    async enrich(step, rows) {
      const outcomes: (EnrichOutcome | undefined)[] = new Array(rows.length).fill(undefined)
      const plan = planEnrich(step, rows, step.dataSourceId)
      for (const r of plan.rejects) outcomes[r.rowIndex] = { kind: 'refused', message: r.errors.join('; ') }
      for (const i of plan.noKey) outcomes[i] = { kind: 'none' }
      const batch = step.mode !== 'row'
      // Cache keys are per step: two steps never share answers, and "Clear cache" is per step.
      const stored = (k: string) => sha256Hex(`${opts.pipelineId}:${step.id}:${k}`)
      const useCache = Boolean(opts.pipelineId) && step.cacheHours > 0
      const cached = new Map<string, Row[] | null>()
      if (useCache && plan.cacheKeys.size) {
        const keys = [...new Set(plan.cacheKeys.values())].map(stored)
        for (let i = 0; i < keys.length; i += 1000) {
          const hits = await db.select().from(apiCallCache).where(and(eq(apiCallCache.workspaceId, opts.workspaceId), inArray(apiCallCache.key, keys.slice(i, i + 1000)), gt(apiCallCache.expiresAt, new Date())))
          for (const h of hits) cached.set(h.key, h.notFound ? null : ((open(h.key, h.value) as Row[] | undefined) ?? null))
        }
      }
      let fromCache = 0
      const answerRow = (i: number, items: Row[] | null) => (outcomes[i] = items && items.length ? { kind: 'items', items } : { kind: 'none' })
      const writes: { key: string; items: Row[] | null }[] = []

      let calls = 0
      const requests = plan.requests
        .map((req) => {
          // Answer what the cache has; ask the API for the rest.
          if (!batch) {
            const k = stored(plan.cacheKeys.get(req.rowIndexes[0])!)
            if (cached.has(k)) {
              for (const i of req.rowIndexes) answerRow(i, cached.get(k)!)
              fromCache += req.rowIndexes.length
              return null
            }
            return req
          }
          const missing = (req.keys ?? []).filter((key) => !cached.has(stored(plan.cacheKeys.get(key)!)))
          for (const key of req.keys ?? []) {
            const k = stored(plan.cacheKeys.get(key)!)
            if (!cached.has(k)) continue
            for (const i of req.rowIndexes) if (rowKey(step, rows[i]) === key) (answerRow(i, cached.get(k)!), fromCache++)
          }
          return missing.length ? { ...req, keys: missing } : null
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)

      // A batch request whose keys were partly cached is planned again for the missing keys only.
      let toSend = requests
      if (batch && requests.some((r, i) => r.keys!.length !== plan.requests[i]?.keys?.length)) {
        const wanted = new Set(requests.flatMap((r) => r.keys!))
        const idx = rows.map((_, i) => i).filter((i) => wanted.has(rowKey(step, rows[i]) ?? ''))
        const again = planEnrich(step, idx.map((i) => rows[i]), step.dataSourceId)
        toSend = again.requests.map((r) => ({ ...r, rowIndexes: r.rowIndexes.map((j) => idx[j]) }))
      }
      if (testing) {
        const used = testCalls.get(step.id) ?? 0
        const allowed = Math.max(0, TEST_ENRICH_CALLS - used)
        for (const r of toSend.slice(allowed)) for (const i of r.rowIndexes) outcomes[i] ??= { kind: 'skipped' }
        toSend = toSend.slice(0, allowed)
        testCalls.set(step.id, used + toSend.length)
      }

      const res = await send(step, toSend.map((r) => r.call), false)
      toSend.forEach((req, n) => {
        const a = res.answers[n]
        if (!a) return
        calls++
        if (a.status === 404) {
          for (const i of req.rowIndexes) outcomes[i] = { kind: 'none' }
          if (batch) for (const key of req.keys!) writes.push({ key: stored(plan.cacheKeys.get(key)!), items: null })
          else writes.push({ key: stored(plan.cacheKeys.get(req.rowIndexes[0])!), items: null })
          return
        }
        if (a.status >= 300) {
          for (const i of req.rowIndexes) outcomes[i] = { kind: 'refused', message: refusal(a) }
          return
        }
        const parsed = parse(a)
        if (!parsed.ok) {
          for (const i of req.rowIndexes) outcomes[i] = { kind: 'refused', message: parsed.message }
          return
        }
        if (!batch) {
          const items = mapAnswer(parsed.payload, step.answer)
          for (const i of req.rowIndexes) answerRow(i, items)
          writes.push({ key: stored(plan.cacheKeys.get(req.rowIndexes[0])!), items })
          return
        }
        const byKey = matchBatchAnswer(step, parsed.payload)
        for (const i of req.rowIndexes) answerRow(i, byKey.get(rowKey(step, rows[i]) ?? '') ?? null)
        for (const key of req.keys!) writes.push({ key: stored(plan.cacheKeys.get(key)!), items: byKey.get(key) ?? null })
      })

      if (useCache && !testing && writes.length) {
        const now = Date.now()
        const values = writes.map((w) => ({
          key: w.key,
          workspaceId: opts.workspaceId,
          pipelineId: opts.pipelineId!,
          stepId: step.id,
          value: seal(w.key, opts.workspaceId, w.items ?? []),
          notFound: w.items === null || !w.items.length,
          expiresAt: new Date(now + (w.items && w.items.length ? step.cacheHours : NOT_FOUND_HOURS) * 3_600_000),
        }))
        for (let i = 0; i < values.length; i += 500) {
          await db.insert(apiCallCache).values(values.slice(i, i + 500)).onConflictDoUpdate({ target: apiCallCache.key, set: { value: sqlExcluded('value'), notFound: sqlExcluded('notFound'), expiresAt: sqlExcluded('expiresAt') } })
        }
      }
      if (res.error) throw Object.assign(new Error(res.error.message), { retryable: res.error.retryable })
      return { outcomes: outcomes.map((o) => o ?? { kind: 'none' }), calls, cached: fromCache }
    },

    async call(step, rows) {
      const outcomes: ApiCallOutcome[] = new Array(rows.length)
      const empty = Object.fromEntries(step.answer.fields.map((f) => [f.as, null]))
      const keys = rows.map((r) => ledgerKey(step, r))
      const hashes = rows.map((r) => contentHash(step, r))
      const known = new Map<string, LedgerEntry & { id: string }>()
      if (opts.pipelineId) {
        const wanted = [...new Set(keys.filter((k): k is string => k !== null))]
        for (let i = 0; i < wanted.length; i += 1000) {
          const found = await db
            .select()
            .from(apiCallLedger)
            .where(and(eq(apiCallLedger.workspaceId, opts.workspaceId), eq(apiCallLedger.pipelineId, opts.pipelineId), eq(apiCallLedger.stepId, step.id), inArray(apiCallLedger.keyHash, wanted.slice(i, i + 1000))))
          for (const e of found) known.set(e.keyHash, { id: e.id, contentHash: e.contentHash, answer: (open(e.id, e.answer) as Row | undefined) ?? {} })
        }
      }
      // One call per record per chunk: repeats of a key reuse the first one's outcome.
      const first = new Map<string, number>()
      const pending: { index: number; call: ApiCall; action: 'create' | 'update'; key: string; hash: string }[] = []
      rows.forEach((row, i) => {
        const key = keys[i]
        if (key === null) return (outcomes[i] = { kind: 'refused', message: checkText('required', { field: step.keys.join(', ') }) })
        const hash = hashes[i]
        if (hash === null) {
          const r = renderApiCall(step.create, row)
          const why = 'errors' in r ? r.errors.join('; ') : ''
          return (outcomes[i] = { kind: 'refused', message: why })
        }
        if (first.has(key)) return
        first.set(key, i)
        const entry = known.get(key)
        const action = decideCall(step, hash, entry)
        if (action === 'skip') return (outcomes[i] = { kind: 'ok', answer: { ...empty, ...entry!.answer }, sent: false })
        if (testing) return (outcomes[i] = { kind: 'ok', answer: { ...empty, ...(entry?.answer ?? {}) }, sent: false })
        const r = renderApiCall(action === 'create' ? step.create : step.update!, action === 'update' ? { ...row, ...entry!.answer } : row)
        if ('errors' in r) return (outcomes[i] = { kind: 'refused', message: r.errors.join('; ') })
        r.call.headers = { [step.idempotencyHeader]: idempotencyKey(opts.pipelineId ?? 'test', step.id, key, hash) }
        pending.push({ index: i, call: r.call, action, key, hash })
      })

      let calls = 0
      const res = await send(step, pending.map((p) => p.call), true)
      // Record every call that went through before anything else can fail.
      for (const [n, p] of pending.entries()) {
        const a = res.answers[n]
        if (!a) continue
        calls++
        if (a.status >= 300) {
          outcomes[p.index] = { kind: 'refused', message: refusal(a) }
          continue
        }
        const parsed = parse(a)
        const answer = { ...empty, ...(known.get(p.key)?.answer ?? {}), ...((parsed.ok ? mapAnswer(parsed.payload, { ...step.answer, listMode: 'first' })[0] : undefined) ?? {}) }
        outcomes[p.index] = { kind: 'ok', answer, sent: true }
        if (!opts.pipelineId) continue
        const id = known.get(p.key)?.id ?? newId('apl')
        await db
          .insert(apiCallLedger)
          .values({ id, workspaceId: opts.workspaceId, pipelineId: opts.pipelineId, stepId: step.id, keyHash: p.key, contentHash: p.hash, answer: seal(id, opts.workspaceId, answer) })
          .onConflictDoUpdate({ target: [apiCallLedger.pipelineId, apiCallLedger.stepId, apiCallLedger.keyHash], set: { contentHash: p.hash, answer: seal(id, opts.workspaceId, answer), updatedAt: new Date() } })
      }
      if (res.error) throw Object.assign(new Error(res.error.message), { retryable: res.error.retryable })
      // Repeats of a key in this chunk take the first row's outcome.
      rows.forEach((_, i) => {
        if (outcomes[i]) return
        const j = first.get(keys[i]!)
        outcomes[i] = j !== undefined && outcomes[j] ? (outcomes[j].kind === 'ok' ? { ...outcomes[j], sent: false } : outcomes[j]) : { kind: 'refused', message: checkText('required', { field: step.keys.join(', ') }) }
      })
      return { outcomes, calls, cached: 0 }
    },
  }
}

/** A row's normalized key in a batch Enrich (as `planEnrich` keys it). */
const rowKey = (step: EnrichStep, row: Row) => normalizeKeyPart(row[step.keyColumn], step.normalize)

const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`)

/** Cron tick: removes expired cache entries. Never throws. */
export async function purgeApiCache(): Promise<number> {
  try {
    const res = await db.delete(apiCallCache).where(lt(apiCallCache.expiresAt, new Date())).returning({ key: apiCallCache.key })
    return res.length
  } catch (err) {
    console.error('[api-cache] purge failed:', err instanceof Error ? err.message : err)
    return 0
  }
}

/** "Clear cache" on a step, or (right to erasure) every API cache of the workspace. */
export async function clearApiCache(workspaceId: string, scope?: { pipelineId: string; stepId: string }): Promise<number> {
  const res = await db
    .delete(apiCallCache)
    .where(and(eq(apiCallCache.workspaceId, workspaceId), scope ? and(eq(apiCallCache.pipelineId, scope.pipelineId), eq(apiCallCache.stepId, scope.stepId)) : undefined))
    .returning({ key: apiCallCache.key })
  return res.length
}
