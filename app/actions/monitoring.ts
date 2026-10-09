'use server'

import { z } from 'zod'
import { and, desc, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { executionLogs, nexusDatasets, notifications, pipelines } from '@/lib/db/schema'
import { requireUserId } from '@/lib/auth/session'
import { scheduleSchema } from '@/lib/pipelines/definition'

const TZ = 'Asia/Jakarta'
const DELAY_GRACE_MS = 5 * 60 * 1000
const STUCK_RUN_MS = 10 * 60 * 1000

export type PipelineHealth = 'healthy' | 'warning' | 'failed' | 'delayed' | 'paused' | 'never_run'

/** yyyy-MM-dd of a date in Jakarta time. */
function jakartaDay(d: Date) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export async function getMonitoringOverview() {
  const userId = await requireUserId()
  const now = Date.now()
  const since = new Date(now - 8 * 24 * 60 * 60 * 1000)

  const [pipelineRows, runs, datasets] = await Promise.all([
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
      .where(eq(pipelines.userId, userId)),
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
      .where(and(eq(executionLogs.userId, userId), gte(executionLogs.startTime, since)))
      .orderBy(desc(executionLogs.startTime)),
    db
      .select({ name: nexusDatasets.name, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt, columns: nexusDatasets.columns, pipelineId: nexusDatasets.pipelineId })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.userId, userId))
      .orderBy(desc(nexusDatasets.lastLoadedAt)),
  ])

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
    if (day === today && r.status in todayCounts) todayCounts[r.status as keyof typeof todayCounts]++
    if (now - r.startTime.getTime() < 86_400_000) {
      rowsWritten24h += r.recordsSuccess ?? 0
      rowsRejected24h += r.recordsError ?? 0
    }
  }

  const health = pipelineRows.map((p) => {
    const schedule = scheduleSchema.safeParse(p.schedule ?? {}).data
    const scheduled = schedule ? schedule.type !== 'manual' : false
    const running = runs.find((r) => r.pipelineId === p.id && r.status === 'running')
    let state: PipelineHealth
    let reason = ''
    if (running && running.startTime && now - running.startTime.getTime() > STUCK_RUN_MS) {
      state = 'delayed'
      reason = 'A run has been in progress for over 10 minutes'
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
    const recent = runs.filter((r) => r.pipelineId === p.id && r.status !== 'running')
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
    recentRuns: runs.slice(0, 25).map((r) => ({ ...r, pipelineName: names.get(r.pipelineId) ?? 'Deleted pipeline' })),
    datasets: datasets.map((d) => ({ ...d, columnCount: Array.isArray(d.columns) ? d.columns.length : 0, pipelineName: d.pipelineId ? names.get(d.pipelineId) ?? null : null })),
  }
}

// ── Notifications (bell) ─────────────────────────────────────────────────────

export async function listNotifications(limit = 20) {
  const userId = await requireUserId()
  const take = z.number().int().min(1).max(100).parse(limit)
  const [rows, [{ unread }]] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(take),
    db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt))),
  ])
  return { unread, items: rows }
}

export async function markNotificationsRead(ids?: string[]) {
  const userId = await requireUserId()
  const parsed = z.array(z.string().min(1).max(100)).max(200).optional().parse(ids)
  const scope = parsed?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, parsed))
    : eq(notifications.userId, userId)
  await db.update(notifications).set({ readAt: new Date() }).where(and(scope, isNull(notifications.readAt)))
  revalidatePath('/dashboard')
}
