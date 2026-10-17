import { and, eq, gt, isNotNull, lt, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { dataSources, sourceHealthChecks, workspaceMembers } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'
import { can, isRole } from '@/lib/auth/permissions'
import { decryptCredentials } from '@/lib/security/credentials'
import { resolveSecretRefs } from '@/lib/secrets/resolve'
import { isSecretManager } from '@/lib/secrets/types'
import { notify, type NotificationLevel } from '@/lib/notifications'
import { published } from '@/lib/datasets/usage'
import { describeChange, driftFrom, isBreaking, mergeDrift, type SchemaDrift } from './drift'
import type { SchemaScanResult } from './types'

/**
 * Data source health (DS-7) and schema drift (DS-8). Server only.
 *
 * The scheduler tick checks every source whose `nextHealthCheckAt` is due
 * (`runDueHealthChecks`); "Check now" and "Test connection" use the same code.
 * A check tests the connection (through the Nexus Agent for agent-backed
 * sources), and every 6 hours also re-scans the schema. Any new scan is
 * compared with the previous one (`recordScan`): breaking changes are kept on
 * the source as `schemaDrift` until reviewed, with the pipelines they reach.
 * The first failure and the recovery alert the people who manage sources.
 */

type Source = typeof dataSources.$inferSelect

export const RESCAN_AFTER_MS = 6 * 3_600_000
const CHECK_TIMEOUT_MS = 45_000
export const HEALTH_HISTORY_DAYS = 30

const asStrings = (values: Record<string, unknown>) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? '' : String(v)]))
const agentLink = (config: unknown) => (config as { agent?: unknown } | null)?.agent ?? null
const scanOf = (source: Source) => ((source.config ?? {}) as { schemaScan?: SchemaScanResult }).schemaScan ?? null

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`No answer within ${Math.round(ms / 1000)} s.`)), ms)
    promise.then((v) => (clearTimeout(timer), resolve(v)), (e) => (clearTimeout(timer), reject(e)))
  })
}

/** Everyone who manages data sources in the workspace (bell + email). */
async function tellManagers(workspaceId: string, level: NotificationLevel, title: string, lines: string[]) {
  const members = await db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId))
  for (const m of members) {
    if (!isRole(m.role) || !can(m.role, 'sources:manage')) continue
    try {
      await notify({ userId: m.userId, workspaceId, level, title, lines, email: { to: [] } })
    } catch (err) {
      console.error('[health] notification failed:', err instanceof Error ? err.message : err)
    }
  }
}

/**
 * Stores a new schema scan on the source and compares it with the previous
 * one. Breaking changes are merged into `schemaDrift` and alerted.
 * Returns the drift this scan found (null when nothing breaking changed).
 */
export async function recordScan(source: Source, scan: SchemaScanResult, extra: Partial<typeof dataSources.$inferInsert> = {}): Promise<SchemaDrift | null> {
  const previous = scanOf(source)
  const drift = previous ? driftFrom(source.id, previous, scan, await published({ workspaceId: source.workspaceId })) : null
  const merged = mergeDrift(source.schemaDrift as SchemaDrift | null, drift)
  await db
    .update(dataSources)
    .set({ ...extra, config: { ...(source.config as Record<string, unknown>), schemaScan: scan }, schemaDrift: merged, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, source.workspaceId)))
  if (drift) {
    const breaking = drift.changes.filter(isBreaking)
    await tellManagers(source.workspaceId, drift.affected.length ? 'warning' : 'info', `Schema changed in ${source.name}`, [
      `The latest scan of "${source.name}" found ${breaking.length} change(s) that can break pipelines:`,
      ...breaking.slice(0, 10).map((c) => `• ${describeChange(c)}`),
      ...(drift.affected.length ? [`Pipelines that read them: ${drift.affected.map((a) => a.name).join(', ')}.`] : ['No published pipeline names these columns.']),
      'Review it in Data sources → Health & schema changes.',
    ])
  }
  return drift
}

export interface HealthResult {
  ok: boolean
  message: string
  latencyMs: number
  scanned: boolean
  drift: SchemaDrift | null
}

/** One health check: test, re-scan when due (or asked), record, update status, alert on change. */
export async function checkSourceHealth(source: Source, opts: { trigger: 'schedule' | 'manual'; rescan?: boolean } = { trigger: 'schedule' }): Promise<HealthResult> {
  const started = Date.now()
  let ok = false
  let message = ''
  let scanned = false
  let drift: SchemaDrift | null = null
  let latencyMs = 0
  try {
    if (source.sourceType === 'file') {
      ok = true
      message = 'Uploaded files need no connection.'
    } else {
      const { testSource, scanSource } = await import('@/lib/agent/sources')
      const credentials = await resolveSecretRefs(source.workspaceId, asStrings(decryptCredentials(source.id, source.credentials)))
      const restDestination = source.sourceType === 'rest' && (source.config as { role?: string } | null)?.role === 'destination' && !agentLink(source.config)
      const test = restDestination ? await withTimeout((await import('@/lib/connectors/rest/write')).testRestDestination(credentials), CHECK_TIMEOUT_MS) : await withTimeout(testSource(source, credentials), agentLink(source.config) ? 70_000 : CHECK_TIMEOUT_MS)
      latencyMs = Date.now() - started
      ok = test.ok
      message = test.message
      const last = scanOf(source)
      const due = !last || Date.now() - new Date(last.scannedAt).getTime() > RESCAN_AFTER_MS
      if (ok && !restDestination && !isSecretManager(source.sourceType) && (opts.rescan || due)) {
        const scan = await scanSource(source, credentials)
        drift = await recordScan(source, scan)
        scanned = true
      }
    }
  } catch (err) {
    ok = false
    message = err instanceof Error ? err.message : String(err)
  }
  if (!latencyMs) latencyMs = Date.now() - started
  const now = new Date()
  await db.insert(sourceHealthChecks).values({
    id: newId('hc'),
    workspaceId: source.workspaceId,
    dataSourceId: source.id,
    checkedAt: now,
    ok,
    latencyMs,
    message: message.slice(0, 1000),
    trigger: opts.trigger,
    scanned,
    drift: drift ? { breaking: drift.changes.filter(isBreaking).length, total: drift.changes.length, affected: drift.affected.length } : null,
  })
  const failures = ok ? 0 : (source.healthFailures ?? 0) + 1
  await db
    .update(dataSources)
    .set({
      status: ok ? 'connected' : 'error',
      ...(ok ? { lastConnected: now } : {}),
      lastHealthCheckAt: now,
      healthFailures: failures,
      nextHealthCheckAt: source.healthCheckMinutes > 0 ? new Date(now.getTime() + source.healthCheckMinutes * 60_000) : null,
    })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, source.workspaceId)))
  // Alert once when a source starts failing, and once when it recovers.
  if (!ok && failures === 1) {
    await tellManagers(source.workspaceId, 'error', `${source.name} is not reachable`, [`The health check of "${source.name}" failed: ${message}`, 'Pipelines reading it will fail until it is fixed. Open Data sources → Health & schema changes.'])
  } else if (ok && (source.healthFailures ?? 0) > 0) {
    await tellManagers(source.workspaceId, 'info', `${source.name} is reachable again`, [`The health check of "${source.name}" passed after ${source.healthFailures} failed check(s).`])
  }
  return { ok, message, latencyMs, scanned, drift }
}

/** Scheduler: checks the sources that are due, within a time budget. */
export async function runDueHealthChecks(opts: { budgetMs?: number; limit?: number; workspaceId?: string } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 60_000)
  const now = new Date()
  const due = await db
    .select()
    .from(dataSources)
    .where(and(gt(dataSources.healthCheckMinutes, 0), isNotNull(dataSources.nextHealthCheckAt), lte(dataSources.nextHealthCheckAt, now), ...(opts.workspaceId ? [eq(dataSources.workspaceId, opts.workspaceId)] : [])))
    .orderBy(dataSources.nextHealthCheckAt)
    .limit(opts.limit ?? 20)
  let checked = 0
  for (const source of due) {
    if (Date.now() > deadline) break
    // Claim: move the next check forward so a parallel tick skips it.
    const claimed = await db
      .update(dataSources)
      .set({ nextHealthCheckAt: new Date(Date.now() + source.healthCheckMinutes * 60_000) })
      .where(and(eq(dataSources.id, source.id), eq(dataSources.nextHealthCheckAt, source.nextHealthCheckAt!)))
      .returning({ id: dataSources.id })
    if (!claimed.length) continue
    try {
      await checkSourceHealth(source, { trigger: 'schedule' })
      checked++
    } catch (err) {
      console.error('[health] check failed:', err instanceof Error ? err.message : err)
    }
  }
  return checked
}

/** Health history older than 30 days is removed. */
export async function pruneHealthChecks() {
  await db.delete(sourceHealthChecks).where(lt(sourceHealthChecks.checkedAt, sql`now() - make_interval(days => ${HEALTH_HISTORY_DAYS})`))
}
