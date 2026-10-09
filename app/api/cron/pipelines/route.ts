import { timingSafeEqual } from 'node:crypto'
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelines } from '@/lib/db/schema'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { nextRunAt } from '@/lib/pipelines/schedule'
import { enqueueRun, processJobs, WORKER_BUDGET_MS } from '@/lib/pipelines/jobs'
import { applyDueRetention } from '@/lib/governance/retention'

/**
 * Scheduler tick. Called every minute by Supabase pg_cron (see
 * drizzle/0011_scheduler_jobs.sql) with `Authorization: Bearer $CRON_SECRET`.
 * Queues pipelines whose nextRunAt is due, then works through the job queue
 * (new runs, retries, and runs resuming from a checkpoint) within the budget,
 * and enforces dataset retention policies (hourly per dataset).
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const MAX_ENQUEUE_PER_TICK = 50

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function tick(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const now = new Date()
  const due = await db
    .select({ id: pipelines.id, userId: pipelines.userId, workspaceId: pipelines.workspaceId, schedule: pipelines.schedule, nextRunAt: pipelines.nextRunAt })
    .from(pipelines)
    .where(and(eq(pipelines.enabled, true), isNotNull(pipelines.nextRunAt), lte(pipelines.nextRunAt, now)))
    .orderBy(asc(pipelines.nextRunAt))
    .limit(MAX_ENQUEUE_PER_TICK)

  const queued: { id: string; status: string }[] = []
  for (const p of due) {
    const schedule = scheduleSchema.safeParse(p.schedule ?? {})
    const upcoming = schedule.success ? nextRunAt(schedule.data, now) : null
    // Claim: advance nextRunAt only if no other tick already did.
    const claimed = await db
      .update(pipelines)
      .set({ nextRunAt: upcoming })
      .where(and(eq(pipelines.id, p.id), eq(pipelines.nextRunAt, p.nextRunAt!)))
      .returning({ id: pipelines.id })
    if (!claimed.length) continue
    try {
      // Scheduled runs act as the pipeline's creator, inside its workspace.
      const outcome = await enqueueRun(p.id, { workspaceId: p.workspaceId, actorId: p.userId }, 'schedule')
      queued.push({ id: p.id, status: outcome.status })
    } catch (err) {
      queued.push({ id: p.id, status: `error: ${err instanceof Error ? err.message : String(err)}` })
    }
  }

  await applyDueRetention()
  const processed = await processJobs({ budgetMs: WORKER_BUDGET_MS })
  return Response.json({ due: due.length, queued, processed })
}

export const GET = tick
export const POST = tick
