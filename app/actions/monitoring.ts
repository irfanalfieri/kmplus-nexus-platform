'use server'

import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { connectorInstalls, dataSources, executionLogs, nexusDatasets, notifications, pipelines } from '@/lib/db/schema'
import { requireWorkspace } from '@/lib/auth/session'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { activeJobs } from '@/lib/pipelines/jobs'
import { nudgeWorker } from '@/lib/pipelines/worker'
import { guard } from '@/lib/server-action'

const TZ = 'Asia/Jakarta'
const DELAY_GRACE_MS = 5 * 60 * 1000
/** A background job waiting this long for a worker means the scheduler or worker is not keeping up. */
const STALLED_JOB_MS = 10 * 60 * 1000

export type PipelineHealth = 'healthy' | 'warning' | 'failed' | 'delayed' | 'paused' | 'never_run'

/** yyyy-MM-dd of a date in Jakarta time. */
function jakartaDay(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

async function getMonitoringOverviewImpl() {
  const ctx = await requireWorkspace()
  const now = Date.now()
  const since = new Date(now - 8 * 24 * 60 * 60 * 1000)

  const [pipelineRows, runs, datasets, jobs] = await Promise.all([
    db
      .select({
        id: pipelines.id,
        name: pipelines.name,
        enabled: pipelines.enabled,
        schedule: pipelines.schedule,
        lastRunAt: pipelines.lastRunAt,
        lastRunStatus: pipelines.lastRunStatus,
        nextRunAt: pipelines.nextRunAt,
        version: pipelines.version,
      })
      .from(pipelines)
      .where(eq(pipelines.workspaceId, ctx.workspaceId)),
    db
      .select({
        id: executionLogs.id,
        pipelineId: executionLogs.pipelineId,
        status: executionLogs.status,
        trigger: executionLogs.trigger,
        startTime: executionLogs.startTime,
        duration: executionLogs.duration,
        recordsProcessed: executionLogs.recordsProcessed,
        recordsSuccess: executionLogs.recordsSuccess,
        recordsError: executionLogs.recordsError,
        errorMessage: executionLogs.errorMessage,
      })
      .from(executionLogs)
      .where(and(eq(executionLogs.workspaceId, ctx.workspaceId), gte(executionLogs.startTime, since)))
      .orderBy(desc(executionLogs.startTime)),
    db
      .select({ name: nexusDatasets.name, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt, columns: nexusDatasets.columns, pipelineId: nexusDatasets.pipelineId })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.workspaceId, ctx.workspaceId))
      .orderBy(desc(nexusDatasets.lastLoadedAt)),
    activeJobs(ctx.workspaceId),
  ])
  if (jobs.length) await nudgeWorker(ctx.workspaceId)

  const names = new Map(pipelineRows.map((p) => [p.id, p.name]))
  const today = jakartaDay(new Date(now))

  // Last 7 days (Jakarta), oldest first.
  const days = Array.from({ length: 7 }, (_, i) => jakartaDay(new Date(now - (6 - i) * 86_400_000)))
  const trend = days.map((day) => ({ day, success: 0, partial: 0, failed: 0 }))
  const byDay = new Map(trend.map((t) => [t.day, t]))
  const todayCounts = { success: 0, partial: 0, failed: 0, running: 0 }
  let rowsWritten24h = 0
  let rowsRejected24h = 0
  for (const r of runs) {
    if (!r.startTime) continue
    const day = jakartaDay(r.startTime)
    const bucket = byDay.get(day)
    if (bucket && (r.status === 'success' || r.status === 'partial' || r.status === 'failed')) bucket[r.status]++
    const counted = r.status === 'queued' ? 'running' : r.status
    if (day === today && counted in todayCounts) todayCounts[counted as keyof typeof todayCounts]++
    if (now - r.startTime.getTime() < 86_400_000) {
      rowsWritten24h += r.recordsSuccess ?? 0
      rowsRejected24h += r.recordsError ?? 0
    }
  }

  const health = pipelineRows.map((p) => {
    const schedule = scheduleSchema.safeParse(p.schedule ?? {}).data
    const scheduled = schedule ? schedule.type !== 'manual' : false
    const job = jobs.find((j) => j.pipelineId === p.id)
    // Waiting for a worker: queued past its retry time, or abandoned (lease expired) and not resumed.
    const waitingSince = job ? (job.status === 'queued' ? job.availableAt : job.leaseUntil) : null
    let state: PipelineHealth
    let reason = ''
    if (waitingSince && now - waitingSince.getTime() > STALLED_JOB_MS) {
      state = 'delayed'
      reason = 'A run has been waiting for the background worker for over 10 minutes'
    } else if (scheduled && !p.enabled) {
      state = 'paused'
      reason = 'Schedule paused'
    } else if (scheduled && p.enabled && p.nextRunAt && now - p.nextRunAt.getTime() > DELAY_GRACE_MS) {
      state = 'delayed'
      reason = 'Scheduled run is overdue'
    } else if (p.lastRunStatus === 'failed') {
      state = 'failed'
      reason = runs.find((r) => r.pipelineId === p.id && r.status === 'failed')?.errorMessage ?? 'Last run failed'
    } else if (p.lastRunStatus === 'partial') {
      state = 'warning'
      reason = 'Last run rejected some rows'
    } else if (p.lastRunStatus === 'success') {
      state = 'healthy'
    } else {
      state = 'never_run'
    }
    const recent = runs.filter((r) => r.pipelineId === p.id && r.status !== 'running' && r.status !== 'queued')
    const ok = recent.filter((r) => r.status !== 'failed').length
    return {
      id: p.id,
      name: p.name,
      version: p.version ?? 1,
      state,
      reason,
      scheduled,
      enabled: p.enabled ?? false,
      lastRunAt: p.lastRunAt,
      nextRunAt: p.nextRunAt,
      successRate7d: recent.length ? Math.round((ok / recent.length) * 100) : null,
      runs7d: recent.length,
    }
  })

  const order: PipelineHealth[] = ['failed', 'delayed', 'warning', 'paused', 'never_run', 'healthy']
  health.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name))

  return {
    generatedAt: new Date(now),
    today: todayCounts,
    rowsWritten24h,
    rowsRejected24h,
    trend,
    health,
    jobs: jobs.map((j) => ({ ...j, pipelineName: names.get(j.pipelineId) ?? 'Deleted pipeline' })),
    recentRuns: runs.slice(0, 25).map((r) => ({ ...r, pipelineName: names.get(r.pipelineId) ?? 'Deleted pipeline' })),
    datasets: datasets.map((d) => ({ ...d, columnCount: Array.isArray(d.columns) ? d.columns.length : 0, pipelineName: d.pipelineId ? names.get(d.pipelineId) ?? null : null })),
  }
}

// ── Notifications (bell) ─────────────────────────────────────────────────────

async function listNotificationsImpl(limit = 20) {
  const ctx = await requireWorkspace()
  const take = z.number().int().min(1).max(100).parse(limit)
  const [rows, [{ unread }]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId)))
      .orderBy(desc(notifications.createdAt))
      .limit(take),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId), isNull(notifications.readAt))),
  ])
  return { unread, items: rows }
}

async function markNotificationsReadImpl(ids?: string[]) {
  const ctx = await requireWorkspace()
  const parsed = z.array(z.string().min(1).max(100)).max(200).optional().parse(ids)
  const scope = parsed?.length
    ? and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId), inArray(notifications.id, parsed))
    : and(eq(notifications.userId, ctx.userId), eq(notifications.workspaceId, ctx.workspaceId))
  await db.update(notifications).set({ readAt: new Date() }).where(and(scope, isNull(notifications.readAt)))
  revalidatePath('/dashboard')
}

// ── Overview (dashboard home) ────────────────────────────────────────────────

async function getOverviewImpl() {
  const ctx = await requireWorkspace()
  const since24h = new Date(Date.now() - 86_400_000)
  const [[sources], [installs], [pipes], [runs24], [datasets], attention] = await Promise.all([
    db
      .select({ total: sql<number>`count(*)::int`, connected: sql<number>`count(*) filter (where ${dataSources.status} = 'connected')::int` })
      .from(dataSources)
      .where(eq(dataSources.workspaceId, ctx.workspaceId)),
    db
      .select({ installed: sql<number>`count(*) filter (where ${connectorInstalls.installedAt} is not null)::int` })
      .from(connectorInstalls)
      .where(eq(connectorInstalls.workspaceId, ctx.workspaceId)),
    db
      .select({
        total: sql<number>`count(*)::int`,
        scheduled: sql<number>`count(*) filter (where ${pipelines.enabled} and ${pipelines.nextRunAt} is not null)::int`,
        failing: sql<number>`count(*) filter (where ${pipelines.lastRunStatus} = 'failed')::int`,
        everRun: sql<number>`count(*) filter (where ${pipelines.lastRunAt} is not null)::int`,
      })
      .from(pipelines)
      .where(eq(pipelines.workspaceId, ctx.workspaceId)),
    db
      .select({
        runs: sql<number>`count(*)::int`,
        failed: sql<number>`count(*) filter (where ${executionLogs.status} = 'failed')::int`,
        written: sql<number>`coalesce(sum(${executionLogs.recordsSuccess}), 0)::int`,
      })
      .from(executionLogs)
      .where(and(eq(executionLogs.workspaceId, ctx.workspaceId), gte(executionLogs.startTime, since24h))),
    db
      .select({ count: sql<number>`count(*)::int`, rows: sql<number>`coalesce(sum(${nexusDatasets.rowCount}), 0)::int` })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.workspaceId, ctx.workspaceId)),
    db
      .select({ id: pipelines.id, name: pipelines.name, lastRunStatus: pipelines.lastRunStatus, lastRunAt: pipelines.lastRunAt })
      .from(pipelines)
      .where(and(eq(pipelines.workspaceId, ctx.workspaceId), inArray(pipelines.lastRunStatus, ['failed', 'partial'])))
      .orderBy(desc(pipelines.lastRunAt))
      .limit(5),
  ])
  return {
    sources,
    connectorsInstalled: installs?.installed ?? 0,
    pipelines: pipes,
    last24h: runs24,
    datasets,
    attention,
    checklist: [
      { key: 'connector', label: 'Install a connector', done: (installs?.installed ?? 0) > 0, tab: 'connectors' },
      { key: 'source', label: 'Connect a data source', done: sources.connected > 0, tab: 'sources' },
      { key: 'pipeline', label: 'Create a pipeline', done: pipes.total > 0, tab: 'pipelines' },
      { key: 'run', label: 'Run it once', done: pipes.everRun > 0, tab: 'pipelines' },
      { key: 'schedule', label: 'Put it on a schedule', done: pipes.scheduled > 0, tab: 'pipelines' },
    ],
  }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/monitoring.ts. ──

export async function getMonitoringOverview(...args: Parameters<typeof getMonitoringOverviewImpl>) {
  return guard(() => getMonitoringOverviewImpl(...args))
}

export async function listNotifications(...args: Parameters<typeof listNotificationsImpl>) {
  return guard(() => listNotificationsImpl(...args))
}

export async function markNotificationsRead(...args: Parameters<typeof markNotificationsReadImpl>) {
  return guard(() => markNotificationsReadImpl(...args))
}

export async function getOverview(...args: Parameters<typeof getOverviewImpl>) {
  return guard(() => getOverviewImpl(...args))
}
