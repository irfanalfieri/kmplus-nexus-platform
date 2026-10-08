import { timingSafeEqual } from 'node:crypto'
import { and, asc, eq, isNotNull, lte } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelines } from '@/lib/db/schema'
import { scheduleSchema } from '@/lib/pipelines/definition'
import { nextRunAt } from '@/lib/pipelines/schedule'
import { executePipelineRun } from '@/lib/pipelines/runner'

/**
 * Scheduler tick. Called every minute by Supabase pg_cron (see
 * drizzle/0003_pipeline_scheduler.sql) with `Authorization: Bearer $CRON_SECRET`.
 * Runs pipelines whose nextRunAt is due, oldest first, within a time budget.
 */
export const maxDuration = 300
export const dynamic = 'force-dynamic'

const TIME_BUDGET_MS = 240_000
const MAX_PER_TICK = 20

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function tick(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const started = Date.now()
  const now = new Date()
  const due = await db
    .select({ id: pipelines.id, userId: pipelines.userId, schedule: pipelines.schedule, nextRunAt: pipelines.nextRunAt })
    .from(pipelines)
    .where(and(eq(pipelines.enabled, true), isNotNull(pipelines.nextRunAt), lte(pipelines.nextRunAt, now)))
    .orderBy(asc(pipelines.nextRunAt))
    .limit(MAX_PER_TICK)

  const results: { id: string; status: string; message: string }[] = []
  for (const p of due) {
    if (Date.now() - started > TIME_BUDGET_MS) break
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
      const outcome = await executePipelineRun(p.id, p.userId, 'schedule')
      results.push({ id: p.id, status: outcome.status, message: outcome.message })
    } catch (err) {
      results.push({ id: p.id, status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  return Response.json({ due: due.length, ran: results.length, results })
}

export const GET = tick
export const POST = tick
