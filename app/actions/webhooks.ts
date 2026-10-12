'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { webhookDeliveries, webhooks } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { encryptCredentials } from '@/lib/security/credentials'
import { assertPublicHttpsUrl, UnsafeUrlError } from '@/lib/net/safe-url'
import { WEBHOOK_EVENTS, emitEvent } from '@/lib/webhooks/deliver'
import { guard } from '@/lib/server-action'

/** Outbound webhooks (API-5): admins subscribe HTTPS endpoints to run and dataset events. */

const idSchema = z.string().min(1).max(100)

async function owned(ctx: WorkspaceContext, id: string) {
  const [row] = await db.select().from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Webhook not found')
  return row
}

async function checkUrl(url: string) {
  try {
    return (await assertPublicHttpsUrl(url)).toString()
  } catch (err) {
    throw new Error(err instanceof UnsafeUrlError ? err.message : 'Invalid URL')
  }
}

async function listWebhooksImpl() {
  const ctx = await requireWorkspace('api:manage')
  const rows = await db.select().from(webhooks).where(eq(webhooks.workspaceId, ctx.workspaceId)).orderBy(desc(webhooks.createdAt))
  const recent = await db
    .select({ id: webhookDeliveries.id, webhookId: webhookDeliveries.webhookId, event: webhookDeliveries.event, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts, responseStatus: webhookDeliveries.responseStatus, error: webhookDeliveries.error, createdAt: webhookDeliveries.createdAt })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.workspaceId, ctx.workspaceId))
    .orderBy(desc(webhookDeliveries.createdAt))
    .limit(100)
  return rows.map(({ secret: _secret, ...w }) => ({ ...w, events: w.events as string[], deliveries: recent.filter((d) => d.webhookId === w.id).slice(0, 10) }))
}

const createInput = z.object({
  url: z.string().trim().min(1).max(2000),
  description: z.string().trim().max(200).default(''),
  events: z.array(z.enum(WEBHOOK_EVENTS)).min(1, 'Choose at least one event'),
})

/** Creates a webhook and returns its signing secret once. */
async function createWebhookImpl(input: z.input<typeof createInput>) {
  const ctx = await requireWorkspace('api:manage')
  const data = createInput.parse(input)
  const url = await checkUrl(data.url)
  const id = newId('wh')
  const secret = `whsec_${randomBytes(24).toString('base64url')}`
  await db.insert(webhooks).values({ id, workspaceId: ctx.workspaceId, url, description: data.description, events: data.events, secret: encryptCredentials(id, { secret }, ctx.workspaceId), createdBy: ctx.userId })
  await recordAudit(ctx, { action: 'CREATE', resource: 'webhook', resourceId: id, changes: { url, events: data.events } })
  revalidatePath('/dashboard', 'layout')
  return { id, secret }
}

const updateInput = z.object({ id: idSchema, enabled: z.boolean().optional(), events: z.array(z.enum(WEBHOOK_EVENTS)).min(1).optional(), url: z.string().trim().min(1).max(2000).optional() })

async function updateWebhookImpl(input: z.input<typeof updateInput>) {
  const ctx = await requireWorkspace('api:manage')
  const data = updateInput.parse(input)
  await owned(ctx, data.id)
  const url = data.url ? await checkUrl(data.url) : undefined
  await db
    .update(webhooks)
    .set({ ...(data.enabled !== undefined ? { enabled: data.enabled } : {}), ...(data.events ? { events: data.events } : {}), ...(url ? { url } : {}), updatedAt: new Date() })
    .where(eq(webhooks.id, data.id))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'webhook', resourceId: data.id, changes: { enabled: data.enabled, events: data.events, url } })
  revalidatePath('/dashboard', 'layout')
}

async function deleteWebhookImpl(rawId: string) {
  const ctx = await requireWorkspace('api:manage')
  const hook = await owned(ctx, idSchema.parse(rawId))
  await db.delete(webhookDeliveries).where(eq(webhookDeliveries.webhookId, hook.id))
  await db.delete(webhooks).where(eq(webhooks.id, hook.id))
  await recordAudit(ctx, { action: 'DELETE', resource: 'webhook', resourceId: hook.id, changes: { url: hook.url } })
  revalidatePath('/dashboard', 'layout')
}

/** Sends a signed "ping" event now and reports what the endpoint answered. */
async function testWebhookImpl(rawId: string) {
  const ctx = await requireWorkspace('api:manage')
  const hook = await owned(ctx, idSchema.parse(rawId))
  const [deliveryId] = await emitEvent(ctx.workspaceId, 'ping', { message: 'Test delivery from KMPlus Nexus', webhook_id: hook.id }, hook.id)
  if (!deliveryId) throw new Error('Could not create the test delivery.')
  const [d] = await db.select().from(webhookDeliveries).where(eq(webhookDeliveries.id, deliveryId)).limit(1)
  await recordAudit(ctx, { action: 'RUN', resource: 'webhook', resourceId: hook.id, changes: { test: true, status: d.status, responseStatus: d.responseStatus } })
  return { delivered: d.status === 'delivered', responseStatus: d.responseStatus, error: d.error }
}

export async function listWebhooks(...args: Parameters<typeof listWebhooksImpl>) {
  return guard(() => listWebhooksImpl(...args))
}

export async function createWebhook(...args: Parameters<typeof createWebhookImpl>) {
  return guard(() => createWebhookImpl(...args))
}

export async function updateWebhook(...args: Parameters<typeof updateWebhookImpl>) {
  return guard(() => updateWebhookImpl(...args))
}

export async function deleteWebhook(...args: Parameters<typeof deleteWebhookImpl>) {
  return guard(() => deleteWebhookImpl(...args))
}

export async function testWebhook(...args: Parameters<typeof testWebhookImpl>) {
  return guard(() => testWebhookImpl(...args))
}
