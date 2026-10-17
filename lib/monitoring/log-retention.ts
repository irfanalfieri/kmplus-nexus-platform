import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { executionLogs, pipelineRunRejects, workspaces } from '@/lib/db/schema'
import { LOG_DETAIL_DAYS, RUN_SUMMARY_DAYS } from './log-retention-options'

/**
 * Run log retention (MN-7). Server only. Each workspace keeps a run's detailed
 * log (log lines, error stack) for `logDetailDays`, and the run itself (status,
 * counts, timing, per-step totals) for `runSummaryDays`. Pruned hourly by the
 * scheduler tick. Runs that still have rows waiting in Data quality are kept
 * until those rows are decided.
 */

export { LOG_DETAIL_DAYS, RUN_SUMMARY_DAYS }

const DAY = 86_400_000
const PER_TICK = 20

/** Prunes one workspace now; returns what changed. */
export async function pruneWorkspaceLogs(workspaceId: string, detailDays: number, summaryDays: number, now = new Date()) {
  const detailBefore = new Date(now.getTime() - detailDays * DAY)
  const summaryBefore = new Date(now.getTime() - summaryDays * DAY)
  // Details: keep the totals, drop the log lines and the stack.
  const trimmed = await db
    .update(executionLogs)
    .set({ executionDetails: sql`(coalesce(${executionLogs.executionDetails}, '{}'::jsonb) - 'log' - 'errorStack') || jsonb_build_object('detailsPrunedAt', ${now.toISOString()}::text)` })
    .where(and(eq(executionLogs.workspaceId, workspaceId), lt(executionLogs.createdAt, detailBefore), sql`${executionLogs.status} <> 'running'`, sql`NOT (coalesce(${executionLogs.executionDetails}, '{}'::jsonb) ? 'detailsPrunedAt')`))
    .returning({ id: executionLogs.id })
  // Summaries: whole runs, except those with rows still open in Data quality.
  const open = db.select({ runId: pipelineRunRejects.runId }).from(pipelineRunRejects).where(and(eq(pipelineRunRejects.workspaceId, workspaceId), eq(pipelineRunRejects.status, 'open')))
  const old = await db
    .select({ id: executionLogs.id })
    .from(executionLogs)
    .where(and(eq(executionLogs.workspaceId, workspaceId), lt(executionLogs.createdAt, summaryBefore), sql`${executionLogs.status} <> 'running'`, notInArray(executionLogs.id, open)))
    .limit(5000)
  const ids = old.map((r) => r.id)
  if (ids.length) {
    await db.delete(pipelineRunRejects).where(and(eq(pipelineRunRejects.workspaceId, workspaceId), inArray(pipelineRunRejects.runId, ids)))
    await db.delete(executionLogs).where(and(eq(executionLogs.workspaceId, workspaceId), inArray(executionLogs.id, ids)))
  }
  return { trimmed: trimmed.length, deleted: ids.length }
}

/** Scheduler: workspaces not pruned in the last hour. */
export async function pruneDueRunLogs(now = new Date()) {
  const due = await db
    .select({ id: workspaces.id, detail: workspaces.logDetailDays, summary: workspaces.runSummaryDays })
    .from(workspaces)
    .where(or(isNull(workspaces.logsPrunedAt), lt(workspaces.logsPrunedAt, new Date(now.getTime() - 3_600_000))))
    .limit(PER_TICK)
  let trimmed = 0
  let deleted = 0
  for (const w of due) {
    await db.update(workspaces).set({ logsPrunedAt: now }).where(eq(workspaces.id, w.id))
    try {
      const r = await pruneWorkspaceLogs(w.id, w.detail, w.summary, now)
      trimmed += r.trimmed
      deleted += r.deleted
    } catch (err) {
      console.error('[retention] run logs:', err instanceof Error ? err.message : err)
    }
  }
  return { workspaces: due.length, trimmed, deleted }
}
