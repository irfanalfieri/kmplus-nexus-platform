import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelines } from '@/lib/db/schema'
import { recordAudit } from '@/lib/audit'
import { enqueueRun } from '@/lib/pipelines/jobs'
import { startWorker } from '@/lib/pipelines/worker'
import { consumeRateLimit, rateLimitHeaders } from '@/lib/api/rate-limit'

export const dynamic = 'force-dynamic'

const HOOK_LIMIT_PER_MINUTE = 30
const reply = (status: number, body: object, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })

/**
 * Inbound webhook trigger (SC-1/SC-6): POST /api/hooks/pipelines/<id>/<token>
 * queues a run of the pipeline's published version. The secret URL is
 * created in the pipeline's Schedule tab; the request body is ignored.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params
  const limit = await consumeRateLimit(`hook:${id}`, HOOK_LIMIT_PER_MINUTE)
  if (!limit.allowed) return reply(429, { error: 'Too many requests for this pipeline. Retry after the Retry-After header.' }, rateLimitHeaders(limit))
  const [p] = await db.select({ id: pipelines.id, workspaceId: pipelines.workspaceId, userId: pipelines.userId, version: pipelines.version, hash: pipelines.triggerTokenHash }).from(pipelines).where(eq(pipelines.id, id)).limit(1)
  const given = Buffer.from(createHash('sha256').update(token).digest('hex'))
  // Same answer for unknown pipelines and wrong tokens.
  if (!p?.hash || given.length !== Buffer.from(p.hash).length || !timingSafeEqual(given, Buffer.from(p.hash))) return reply(404, { error: 'Unknown webhook URL.' })
  if (!p.version) return reply(409, { error: 'The pipeline has no published version.' })
  const outcome = await enqueueRun(p.id, { workspaceId: p.workspaceId, actorId: p.userId }, 'webhook')
  await recordAudit({ userId: `webhook:${p.id}`, workspaceId: p.workspaceId }, { action: 'RUN', resource: 'pipeline', resourceId: p.id, changes: { trigger: 'webhook', runId: outcome.runId, status: outcome.status } })
  if (outcome.status === 'skipped') return reply(409, { error: outcome.message, run_id: outcome.runId || null })
  startWorker()
  return reply(202, { run_id: outcome.runId, status: 'queued' }, rateLimitHeaders(limit))
}
