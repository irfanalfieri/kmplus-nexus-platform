'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { alertChannels, pipelineAlerts, pipelines, user, workspaceMembers } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { assertPublicHttpsUrl, UnsafeUrlError } from '@/lib/net/safe-url'
import { guard } from '@/lib/server-action'
import { channelInputSchema, channelUrlProblem, pipelineAlertsSchema, type ChannelKind, type PipelineAlerts } from '@/lib/alerts/rules'
import { loadPipelineAlerts, pipelineLink, sendToChannel, slaFacts } from '@/lib/alerts/send'

/**
 * Alerts (MN-5): admins set up channels (Slack, Microsoft Teams, any webhook);
 * people who run pipelines set each pipeline's subscribers, channels, SLA and
 * error-rate alerts; any member can subscribe themselves to a pipeline.
 */

const idSchema = z.string().trim().min(1).max(100)

async function ownedChannel(ctx: WorkspaceContext, id: string) {
  const [row] = await db.select().from(alertChannels).where(and(eq(alertChannels.id, id), eq(alertChannels.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Alert channel not found')
  return row
}

async function ownedPipeline(ctx: WorkspaceContext, id: string) {
  const [row] = await db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(and(eq(pipelines.id, id), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
  if (!row) throw new Error('Pipeline not found')
  return row
}

async function checkChannelUrl(kind: ChannelKind, raw: string) {
  // Slack and Teams hosts are checked here; https (and public hosts) for every kind by assertPublicHttpsUrl.
  const problem = kind === 'webhook' ? null : channelUrlProblem(kind, raw)
  if (problem) throw new Error(problem)
  try {
    return (await assertPublicHttpsUrl(raw)).toString()
  } catch (err) {
    throw new Error(err instanceof UnsafeUrlError ? err.message : 'Invalid URL')
  }
}

/** Only the host of a channel URL is shown again (the path of a Slack or Teams webhook is its secret). */
function urlHost(channel: typeof alertChannels.$inferSelect) {
  try {
    const { url } = decryptCredentials(channel.id, channel.secret) as { url?: string }
    return url ? new URL(url).host : null
  } catch {
    return null
  }
}

async function listAlertChannelsImpl() {
  const ctx = await requireWorkspace()
  const rows = await db.select().from(alertChannels).where(eq(alertChannels.workspaceId, ctx.workspaceId)).orderBy(asc(alertChannels.createdAt))
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    kind: c.kind as ChannelKind,
    allPipelines: c.allPipelines,
    host: urlHost(c),
    lastStatus: c.lastStatus,
    lastError: c.lastError,
    lastSentAt: c.lastSentAt,
  }))
}

/** Creates a channel; a webhook channel's signing secret is returned once. */
async function createAlertChannelImpl(input: z.input<typeof channelInputSchema>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = channelInputSchema.parse(input)
  if (!data.url) throw new Error('Enter the webhook URL')
  const url = await checkChannelUrl(data.kind, data.url)
  const id = newId('ach')
  const signingSecret = data.kind === 'webhook' ? `whsec_${randomBytes(24).toString('base64url')}` : undefined
  await db.insert(alertChannels).values({
    id,
    workspaceId: ctx.workspaceId,
    name: data.name,
    kind: data.kind,
    allPipelines: data.allPipelines,
    secret: encryptCredentials(id, { url, ...(signingSecret ? { signingSecret } : {}) }, ctx.workspaceId),
    createdBy: ctx.userId,
  })
  // The URL is a secret for Slack and Teams: only its host goes in the audit.
  await recordAudit(ctx, { action: 'CREATE', resource: 'alert_channel', resourceId: id, changes: { name: data.name, kind: data.kind, host: new URL(url).host, allPipelines: data.allPipelines } })
  revalidatePath('/dashboard', 'layout')
  return { id, signingSecret: signingSecret ?? null }
}

async function updateAlertChannelImpl(rawId: string, input: z.input<typeof channelInputSchema>) {
  const ctx = await requireWorkspace('workspace:manage')
  const before = await ownedChannel(ctx, idSchema.parse(rawId))
  const data = channelInputSchema.parse({ ...input, kind: before.kind })
  const old = decryptCredentials(before.id, before.secret) as { url?: string; signingSecret?: string }
  const url = data.url ? await checkChannelUrl(data.kind, data.url) : old.url
  await db
    .update(alertChannels)
    .set({ name: data.name, allPipelines: data.allPipelines, secret: encryptCredentials(before.id, { ...old, url }, ctx.workspaceId), updatedAt: new Date() })
    .where(eq(alertChannels.id, before.id))
  await recordAudit(ctx, {
    action: 'UPDATE',
    resource: 'alert_channel',
    resourceId: before.id,
    changes: { name: data.name },
    diff: diffObjects({ name: before.name, allPipelines: before.allPipelines, url: 'stored' }, { name: data.name, allPipelines: data.allPipelines, url: data.url ? 'replaced' : 'stored' }),
  })
  revalidatePath('/dashboard', 'layout')
}

async function deleteAlertChannelImpl(rawId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const channel = await ownedChannel(ctx, idSchema.parse(rawId))
  await db.delete(alertChannels).where(eq(alertChannels.id, channel.id))
  await recordAudit(ctx, { action: 'DELETE', resource: 'alert_channel', resourceId: channel.id, changes: { name: channel.name, kind: channel.kind } })
  revalidatePath('/dashboard', 'layout')
}

/** Sends a test message to a channel. */
async function testAlertChannelImpl(rawId: string) {
  const ctx = await requireWorkspace('workspace:manage')
  const channel = await ownedChannel(ctx, idSchema.parse(rawId))
  const at = new Date().toISOString()
  const result = await sendToChannel(channel, {
    kind: 'test',
    level: 'info',
    title: 'Test alert from KMPlus Nexus',
    lines: [`Channel: ${channel.name}`, 'Pipeline alerts will arrive here.', `Time: ${at}`],
    link: pipelineLink(),
    at,
  })
  await recordAudit(ctx, { action: 'TEST_REQUEST', resource: 'alert_channel', resourceId: channel.id, changes: { name: channel.name, ok: result.ok, status: result.status } })
  return result
}

/** A pipeline's alert settings, with the members and channels to pick from. */
async function getPipelineAlertsImpl(rawPipelineId: string) {
  const ctx = await requireWorkspace()
  const pipeline = await ownedPipeline(ctx, idSchema.parse(rawPipelineId))
  const config = await loadPipelineAlerts(ctx.workspaceId, pipeline.id)
  const members = await db
    .select({ id: user.id, name: user.name, email: user.email, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.userId))
    .where(eq(workspaceMembers.workspaceId, ctx.workspaceId))
    .orderBy(asc(user.name))
  const channels = await db
    .select({ id: alertChannels.id, name: alertChannels.name, kind: alertChannels.kind, allPipelines: alertChannels.allPipelines })
    .from(alertChannels)
    .where(eq(alertChannels.workspaceId, ctx.workspaceId))
    .orderBy(asc(alertChannels.createdAt))
  const [row] = await db.select({ createdAt: pipelineAlerts.createdAt }).from(pipelineAlerts).where(eq(pipelineAlerts.pipelineId, pipeline.id)).limit(1)
  const facts = await slaFacts(ctx.workspaceId, pipeline.id, row?.createdAt ?? new Date())
  return {
    pipeline,
    config,
    members,
    channels: channels.map((c) => ({ ...c, kind: c.kind as ChannelKind })),
    subscribed: config.subscribers.includes(ctx.userId),
    lastSuccessAt: facts.lastSuccessAt,
  }
}

async function writePipelineAlerts(ctx: WorkspaceContext, pipelineId: string, before: PipelineAlerts, config: PipelineAlerts) {
  const sla = config.maxDurationMinutes !== null || config.staleHours !== null
  const slaChanged = config.maxDurationMinutes !== before.maxDurationMinutes || config.staleHours !== before.staleHours
  const values = { config, updatedBy: ctx.userId, updatedAt: new Date(), ...(slaChanged ? { nextCheckAt: sla ? new Date() : null, state: {} } : {}) }
  await db
    .insert(pipelineAlerts)
    .values({ pipelineId, workspaceId: ctx.workspaceId, ...values, nextCheckAt: sla ? new Date() : null })
    .onConflictDoUpdate({ target: pipelineAlerts.pipelineId, set: values })
}

async function savePipelineAlertsImpl(rawPipelineId: string, input: z.input<typeof pipelineAlertsSchema>) {
  const ctx = await requireWorkspace('pipelines:run')
  const pipeline = await ownedPipeline(ctx, idSchema.parse(rawPipelineId))
  const data = pipelineAlertsSchema.parse(input)
  // Only current members and this workspace's channels.
  const members = data.subscribers.length
    ? new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, ctx.workspaceId), inArray(workspaceMembers.userId, data.subscribers)))).map((m) => m.id))
    : new Set<string>()
  const channels = data.channelIds.length
    ? new Set((await db.select({ id: alertChannels.id }).from(alertChannels).where(and(eq(alertChannels.workspaceId, ctx.workspaceId), inArray(alertChannels.id, data.channelIds)))).map((c) => c.id))
    : new Set<string>()
  const config: PipelineAlerts = { ...data, subscribers: data.subscribers.filter((id) => members.has(id)), channelIds: data.channelIds.filter((id) => channels.has(id)) }
  const before = await loadPipelineAlerts(ctx.workspaceId, pipeline.id)
  await writePipelineAlerts(ctx, pipeline.id, before, config)
  await recordAudit(ctx, { action: 'UPDATE', resource: 'pipeline_alerts', resourceId: pipeline.id, changes: { pipeline: pipeline.name }, diff: diffObjects(before, config) })
  revalidatePath('/dashboard', 'layout')
  return config
}

/** Any member subscribes themselves to (or leaves) a pipeline's alerts. */
async function setPipelineSubscriptionImpl(rawPipelineId: string, on: boolean) {
  const ctx = await requireWorkspace()
  const pipeline = await ownedPipeline(ctx, idSchema.parse(rawPipelineId))
  const subscribe = z.boolean().parse(on)
  const before = await loadPipelineAlerts(ctx.workspaceId, pipeline.id)
  const subscribers = subscribe ? Array.from(new Set([...before.subscribers, ctx.userId])) : before.subscribers.filter((id) => id !== ctx.userId)
  await writePipelineAlerts(ctx, pipeline.id, before, { ...before, subscribers })
  await recordAudit(ctx, { action: 'UPDATE', resource: 'pipeline_alerts', resourceId: pipeline.id, changes: { pipeline: pipeline.name, subscribed: subscribe } })
  revalidatePath('/dashboard', 'layout')
  return { subscribed: subscribe }
}

export async function listAlertChannels(...args: Parameters<typeof listAlertChannelsImpl>) {
  return guard(() => listAlertChannelsImpl(...args))
}
export async function createAlertChannel(...args: Parameters<typeof createAlertChannelImpl>) {
  return guard(() => createAlertChannelImpl(...args))
}
export async function updateAlertChannel(...args: Parameters<typeof updateAlertChannelImpl>) {
  return guard(() => updateAlertChannelImpl(...args))
}
export async function deleteAlertChannel(...args: Parameters<typeof deleteAlertChannelImpl>) {
  return guard(() => deleteAlertChannelImpl(...args))
}
export async function testAlertChannel(...args: Parameters<typeof testAlertChannelImpl>) {
  return guard(() => testAlertChannelImpl(...args))
}
export async function getPipelineAlerts(...args: Parameters<typeof getPipelineAlertsImpl>) {
  return guard(() => getPipelineAlertsImpl(...args))
}
export async function savePipelineAlerts(...args: Parameters<typeof savePipelineAlertsImpl>) {
  return guard(() => savePipelineAlertsImpl(...args))
}
export async function setPipelineSubscription(...args: Parameters<typeof setPipelineSubscriptionImpl>) {
  return guard(() => setPipelineSubscriptionImpl(...args))
}
