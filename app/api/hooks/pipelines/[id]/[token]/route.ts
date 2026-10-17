import { createHash, timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelineJobs, pipelines, pipelineTriggerEvents } from '@/lib/db/schema'
import { recordAudit } from '@/lib/audit'
import { enqueueRun } from '@/lib/pipelines/jobs'
import { startWorker } from '@/lib/pipelines/worker'
import { consumeRateLimit, rateLimitHeaders } from '@/lib/api/rate-limit'
import { acceptedEvents, describeEvents, parseInbound, triggerConfigSchema, DEFAULT_TRIGGER_CONFIG, type InboundEvent } from '@/lib/pipelines/events'

export const dynamic = 'force-dynamic'

const HOOK_LIMIT_PER_MINUTE = 30
const MAX_BODY_BYTES = 1_000_000
const reply = (status: number, body: object, headers: Record<string, string> = {}) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex')

/** The pipeline behind a hook URL, or null for an unknown pipeline or a wrong token (same answer). */
async function findPipeline(id: string, token: string) {
  const [p] = await db
    .select({ id: pipelines.id, workspaceId: pipelines.workspaceId, userId: pipelines.userId, version: pipelines.version, hash: pipelines.triggerTokenHash, triggerConfig: pipelines.triggerConfig })
    .from(pipelines)
    .where(eq(pipelines.id, id))
    .limit(1)
  const given = Buffer.from(sha256(token))
  if (!p?.hash || given.length !== Buffer.from(p.hash).length || !timingSafeEqual(given, Buffer.from(p.hash))) return null
  const parsed = triggerConfigSchema.safeParse(p.triggerConfig ?? {})
  return { ...p, config: parsed.success ? parsed.data : DEFAULT_TRIGGER_CONFIG }
}

const headerMap = (req: Request) => Object.fromEntries(Array.from(req.headers.entries()).map(([k, v]) => [k.toLowerCase(), v]))

/**
 * Inbound webhook and event trigger (SC-1/SC-6): POST /api/hooks/pipelines/<id>/<token>
 * queues a run of the pipeline's published version. A plain POST always runs;
 * CloudEvents (SAP Event Mesh, S/4HANA, SuccessFactors), Azure Event Grid and
 * Microsoft Graph notifications are recognized, their handshakes answered,
 * filtered by event type and de-duplicated by id. An event arriving while a run
 * is active is kept: the pipeline runs again when that run finishes.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params
  const limit = await consumeRateLimit(`hook:${id}`, HOOK_LIMIT_PER_MINUTE)
  if (!limit.allowed) return reply(429, { error: 'Too many requests for this pipeline. Retry after the Retry-After header.' }, rateLimitHeaders(limit))
  const p = await findPipeline(id, token)
  if (!p) return reply(404, { error: 'Unknown webhook URL.' })

  const body = await req.text()
  if (body.length > MAX_BODY_BYTES) return reply(413, { error: 'The request body is larger than 1 MB.' })
  const url = new URL(req.url)
  const inbound = parseInbound({ method: 'POST', headers: headerMap(req), query: Object.fromEntries(url.searchParams), body }, p.config.format)
  if (inbound.kind === 'invalid') return reply(400, { error: inbound.message })
  if (inbound.kind === 'handshake') {
    await recordAudit({ userId: `webhook:${p.id}`, workspaceId: p.workspaceId }, { action: 'UPDATE', resource: 'pipeline', resourceId: p.id, changes: { eventHandshake: inbound.format } })
    return new Response(inbound.response.body, { status: inbound.response.status, headers: { 'Cache-Control': 'no-store', 'Content-Type': inbound.response.contentType ?? 'text/plain', ...inbound.response.headers } })
  }
  if (!p.version) return reply(409, { error: 'The pipeline has no published version.' })

  // Microsoft Graph sends back the clientState set on the subscription.
  if (inbound.format === 'graph' && p.config.clientStateHash && inbound.events.some((e) => !e.clientState || sha256(e.clientState) !== p.config.clientStateHash)) {
    return reply(401, { error: 'The clientState does not match this pipeline.' })
  }

  const { accepted, run } = acceptedEvents(p.config, inbound)
  if (!run) return reply(200, { status: 'ignored', reason: 'No event matches the event types this pipeline runs on.' })

  // Drop events already received (senders retry until they see a 2xx).
  let fresh: InboundEvent[] = accepted
  const withId = accepted.filter((e) => e.id)
  if (withId.length) {
    const inserted = await db
      .insert(pipelineTriggerEvents)
      .values(Array.from(new Map(withId.map((e) => [e.id!.slice(0, 500), e])).keys()).map((eventId) => ({ pipelineId: p.id, eventId, workspaceId: p.workspaceId })))
      .onConflictDoNothing()
      .returning({ eventId: pipelineTriggerEvents.eventId })
    const ids = new Set(inserted.map((r) => r.eventId))
    fresh = accepted.filter((e) => !e.id || ids.has(e.id.slice(0, 500)))
    if (!fresh.length) return reply(200, { status: 'duplicate' })
  }

  const event = describeEvents(inbound.format, fresh)
  const outcome = await enqueueRun(p.id, { workspaceId: p.workspaceId, actorId: p.userId }, 'webhook', event ? { event } : {})
  const isEvent = inbound.format !== 'plain'
  if (outcome.status === 'skipped' && isEvent && outcome.runId) {
    // A run that already started may have read past this change: run again when it finishes. A queued one will see it.
    const [active] = await db.select({ status: pipelineJobs.status }).from(pipelineJobs).where(eq(pipelineJobs.id, outcome.runId)).limit(1)
    if (active?.status !== 'queued') await db.update(pipelines).set({ eventPendingAt: new Date() }).where(eq(pipelines.id, p.id))
  }
  await recordAudit(
    { userId: `webhook:${p.id}`, workspaceId: p.workspaceId },
    { action: 'RUN', resource: 'pipeline', resourceId: p.id, changes: { trigger: 'webhook', runId: outcome.runId, status: outcome.status, ...(event ? { event, eventIds: fresh.map((e) => e.id).filter(Boolean).slice(0, 10) } : {}) } }
  )
  if (outcome.status === 'skipped') {
    if (isEvent) return reply(202, { status: 'pending', run_id: outcome.runId || null, message: 'A run is active; the pipeline runs again when it finishes.' }, rateLimitHeaders(limit))
    return reply(409, { error: outcome.message, run_id: outcome.runId || null })
  }
  startWorker()
  return reply(202, { run_id: outcome.runId, status: 'queued' }, rateLimitHeaders(limit))
}

/** The CloudEvents webhook handshake (SAP Event Mesh validates a webhook URL with OPTIONS). */
export async function OPTIONS(req: Request, { params }: { params: Promise<{ id: string; token: string }> }) {
  const { id, token } = await params
  const p = await findPipeline(id, token)
  if (!p) return reply(404, { error: 'Unknown webhook URL.' })
  const inbound = parseInbound({ method: 'OPTIONS', headers: headerMap(req), query: {}, body: '' }, p.config.format)
  if (inbound.kind !== 'handshake') return new Response(null, { status: 204, headers: { Allow: 'POST, OPTIONS' } })
  return new Response(null, { status: inbound.response.status, headers: { 'Cache-Control': 'no-store', ...inbound.response.headers } })
}
