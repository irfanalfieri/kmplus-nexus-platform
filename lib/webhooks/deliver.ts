import { createHmac, randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { webhookDeliveries, webhooks } from '@/lib/db/schema'
import { decryptCredentials } from '@/lib/security/credentials'
import { safeFetch } from '@/lib/net/safe-url'

/**
 * Outbound webhooks (API-5). An event becomes one delivery row per subscribed
 * webhook; delivery is attempted right away and retried by the cron tick
 * (1 min, 5 min, 30 min, 2 h, then failed). Never throws into the caller:
 * a webhook problem must not fail a pipeline run.
 */

export const WEBHOOK_EVENTS = ['run.succeeded', 'run.failed', 'dataset.updated', 'dataset.schema_changed'] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number] | 'ping'

const RETRY_DELAYS_S = [60, 300, 1800, 7200]
const TIMEOUT_MS = 10_000

/** `t=<unix>,v1=<hex>` over "<t>.<body>" (the Stripe convention, so receivers can reuse libraries). */
export function signPayload(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)) {
  const sig = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${sig}`
}

type Delivery = typeof webhookDeliveries.$inferSelect

async function attempt(d: Delivery) {
  const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, d.webhookId)).limit(1)
  if (!hook || !hook.enabled) {
    await db.update(webhookDeliveries).set({ status: 'failed', error: hook ? 'Webhook disabled' : 'Webhook deleted' }).where(eq(webhookDeliveries.id, d.id))
    return
  }
  const body = JSON.stringify(d.payload)
  let status: number | null = null
  let error: string | null = null
  try {
    const secret = String(decryptCredentials(hook.id, hook.secret).secret ?? '')
    const res = await safeFetch(hook.url, {
      method: 'POST',
      timeoutMs: TIMEOUT_MS,
      headers: { 'content-type': 'application/json', 'user-agent': 'KMPlus-Nexus-Webhooks/1.0', 'Nexus-Event': d.event, 'Nexus-Delivery': d.id, 'Nexus-Signature': signPayload(secret, body) },
      body,
    })
    status = res.status
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirects are not followed)' : ''}`
  } catch (err) {
    error = err instanceof Error ? (err.name === 'TimeoutError' ? `No response within ${TIMEOUT_MS / 1000} s` : err.message) : String(err)
  }
  const attempts = d.attempts + 1
  if (!error) {
    await db.update(webhookDeliveries).set({ status: 'delivered', attempts, responseStatus: status, error: null, deliveredAt: new Date() }).where(eq(webhookDeliveries.id, d.id))
    return
  }
  const delay = RETRY_DELAYS_S[attempts - 1]
  await db
    .update(webhookDeliveries)
    .set({ status: delay === undefined ? 'failed' : 'pending', attempts, responseStatus: status, error: error.slice(0, 500), nextAttemptAt: new Date(Date.now() + (delay ?? 0) * 1000) })
    .where(eq(webhookDeliveries.id, d.id))
}

/** Records an event for every enabled webhook subscribed to it and tries to deliver at once. */
export async function emitEvent(workspaceId: string, event: WebhookEvent, data: Record<string, unknown>, onlyWebhookId?: string) {
  try {
    const hooks = await db
      .select({ id: webhooks.id, events: webhooks.events })
      .from(webhooks)
      .where(and(eq(webhooks.workspaceId, workspaceId), eq(webhooks.enabled, true), onlyWebhookId ? eq(webhooks.id, onlyWebhookId) : undefined))
    const targets = hooks.filter((h) => onlyWebhookId || ((h.events as string[]) ?? []).includes(event))
    if (!targets.length) return []
    const rows = targets.map((h) => {
      const id = `whd_${randomUUID()}`
      return { id, workspaceId, webhookId: h.id, event, payload: { id, event, created_at: new Date().toISOString(), workspace_id: workspaceId, data } }
    })
    const inserted = await db.insert(webhookDeliveries).values(rows).returning()
    await Promise.all(inserted.map((d) => attempt(d).catch((err) => console.error('[webhooks] delivery failed:', err instanceof Error ? err.message : err))))
    return inserted.map((d) => d.id)
  } catch (err) {
    console.error('[webhooks] emit failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** Retries due deliveries (cron tick). */
export async function deliverDueWebhooks(limit = 25) {
  const due = await db
    .select()
    .from(webhookDeliveries)
    .where(and(eq(webhookDeliveries.status, 'pending'), lte(webhookDeliveries.nextAttemptAt, new Date()), sql`(${webhookDeliveries.attempts} > 0 OR ${webhookDeliveries.createdAt} < now() - interval '2 minutes')`))
    .orderBy(asc(webhookDeliveries.nextAttemptAt))
    .limit(limit)
  // Claim by pushing nextAttemptAt out, so a concurrent tick skips them.
  if (due.length) await db.update(webhookDeliveries).set({ nextAttemptAt: new Date(Date.now() + 5 * 60_000) }).where(inArray(webhookDeliveries.id, due.map((d) => d.id)))
  await Promise.all(due.map((d) => attempt(d).catch(() => undefined)))
  // Keep 30 days of delivery history.
  await db.delete(webhookDeliveries).where(lte(webhookDeliveries.createdAt, new Date(Date.now() - 30 * 86_400_000)))
  return due.length
}
