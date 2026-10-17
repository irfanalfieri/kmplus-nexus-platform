import { and, desc, eq, inArray, isNotNull, lte, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { alertChannels, executionLogs, pipelineAlerts, pipelines, workspaceMembers } from '@/lib/db/schema'
import { decryptCredentials } from '@/lib/security/credentials'
import { safeFetch } from '@/lib/net/safe-url'
import { signPayload } from '@/lib/webhooks/deliver'
import { appUrl } from '@/lib/email'
import { notify } from '@/lib/notifications'
import { channelPayload, NO_PIPELINE_ALERTS, pipelineAlertsSchema, slaCheck, type Alert, type ChannelKind, type PipelineAlerts, type SlaState } from './rules'

/**
 * Sends alerts to channels and pipeline subscribers (MN-5), and checks SLA
 * alerts from the cron tick. Server only. Never throws into the caller:
 * an alert problem must not fail a run.
 */

const TIMEOUT_MS = 10_000

type Channel = typeof alertChannels.$inferSelect

/** One POST to a channel; records the outcome on the channel. */
export async function sendToChannel(channel: Channel, alert: Alert): Promise<{ ok: boolean; status: number | null; error: string | null }> {
  let status: number | null = null
  let error: string | null = null
  try {
    const secret = decryptCredentials(channel.id, channel.secret) as { url?: string; signingSecret?: string }
    if (!secret.url) throw new Error('The channel has no URL')
    const body = JSON.stringify(channelPayload(channel.kind as ChannelKind, alert))
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': 'KMPlus-Nexus-Alerts/1.0' }
    if (channel.kind === 'webhook' && secret.signingSecret) {
      headers['Nexus-Event'] = 'alert'
      headers['Nexus-Signature'] = signPayload(secret.signingSecret, body)
    }
    const res = await safeFetch(secret.url, { method: 'POST', timeoutMs: TIMEOUT_MS, headers, body })
    status = res.status
    if (res.status < 200 || res.status >= 300) error = `HTTP ${res.status}${res.status >= 300 && res.status < 400 ? ' (redirects are not followed)' : ''}`
  } catch (err) {
    error = err instanceof Error ? (err.name === 'TimeoutError' ? `No response within ${TIMEOUT_MS / 1000} s` : err.message) : String(err)
  }
  await db
    .update(alertChannels)
    .set({ lastStatus: error ? 'failed' : 'sent', lastError: error?.slice(0, 500) ?? null, lastSentAt: new Date() })
    .where(eq(alertChannels.id, channel.id))
    .catch(() => undefined)
  return { ok: !error, status, error }
}

export async function loadPipelineAlerts(workspaceId: string, pipelineId: string): Promise<PipelineAlerts> {
  const [row] = await db
    .select({ config: pipelineAlerts.config })
    .from(pipelineAlerts)
    .where(and(eq(pipelineAlerts.pipelineId, pipelineId), eq(pipelineAlerts.workspaceId, workspaceId)))
    .limit(1)
  const parsed = pipelineAlertsSchema.safeParse(row?.config ?? {})
  return parsed.success ? parsed.data : NO_PIPELINE_ALERTS
}

export const pipelineLink = (pipelineId?: string) => `${appUrl()}/dashboard/${pipelineId ? 'pipelines' : 'monitoring'}`

/**
 * A pipeline alert to its channels (those it picked and those set to every
 * pipeline) and to its subscribers (bell + email each). `notified` lists the
 * members whose bell the caller already filled, so nobody gets it twice.
 */
export async function deliverAlert(workspaceId: string, alert: Alert, opts: { config?: PipelineAlerts; notified?: string[] } = {}) {
  try {
    const config = opts.config ?? (alert.pipelineId ? await loadPipelineAlerts(workspaceId, alert.pipelineId) : NO_PIPELINE_ALERTS)
    const channels = await db
      .select()
      .from(alertChannels)
      .where(
        and(
          eq(alertChannels.workspaceId, workspaceId),
          config.channelIds.length ? or(eq(alertChannels.allPipelines, true), inArray(alertChannels.id, config.channelIds)) : eq(alertChannels.allPipelines, true)
        )
      )
    const results = await Promise.all(channels.map((c) => sendToChannel(c, alert)))
    if (config.subscribers.length) {
      // Only people who are still members of the workspace.
      const members = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.userId, config.subscribers)))
      const already = new Set(opts.notified ?? [])
      for (const m of members) {
        await notify({
          userId: m.userId,
          workspaceId,
          level: alert.level,
          title: alert.title,
          lines: alert.lines,
          pipelineId: alert.pipelineId,
          runId: alert.runId,
          // Subscribers always get the email; their bell only if the caller didn't fill it.
          email: { to: [] },
          ...(already.has(m.userId) ? { bell: false } : {}),
        })
      }
    }
    return { channels: results.length, failed: results.filter((r) => !r.ok).length }
  } catch (err) {
    console.error('[alerts] delivery failed:', err instanceof Error ? err.message : err)
    return { channels: 0, failed: 0 }
  }
}

const SLA_BATCH = 100

/** The cron tick: SLA alerts that are due (a run going too long, no success for too long). */
export async function checkAlertSlas(now = new Date()) {
  let sent = 0
  const due = await db
    .select()
    .from(pipelineAlerts)
    .where(and(isNotNull(pipelineAlerts.nextCheckAt), lte(pipelineAlerts.nextCheckAt, now)))
    .limit(SLA_BATCH)
  for (const row of due) {
    try {
      const parsed = pipelineAlertsSchema.safeParse(row.config)
      const config = parsed.success ? parsed.data : NO_PIPELINE_ALERTS
      const [pipeline] = await db.select({ name: pipelines.name, enabled: pipelines.enabled }).from(pipelines).where(and(eq(pipelines.id, row.pipelineId), eq(pipelines.workspaceId, row.workspaceId))).limit(1)
      if (!pipeline) {
        await db.delete(pipelineAlerts).where(eq(pipelineAlerts.pipelineId, row.pipelineId))
        continue
      }
      const facts = await slaFacts(row.workspaceId, row.pipelineId, row.createdAt, now)
      const result = slaCheck(config, facts, (row.state ?? {}) as SlaState)
      for (const kind of result.alerts) {
        const alert = slaAlert(kind, { pipelineId: row.pipelineId, pipelineName: pipeline.name, config, facts })
        await deliverAlert(row.workspaceId, alert, { config })
        await notifyOperators(row.workspaceId, alert, config.subscribers)
        sent++
      }
      await db.update(pipelineAlerts).set({ state: result.state, nextCheckAt: result.nextCheckAt }).where(eq(pipelineAlerts.pipelineId, row.pipelineId))
    } catch (err) {
      console.error('[alerts] SLA check failed:', err instanceof Error ? err.message : err)
      await db.update(pipelineAlerts).set({ nextCheckAt: new Date(now.getTime() + 15 * 60_000) }).where(eq(pipelineAlerts.pipelineId, row.pipelineId)).catch(() => undefined)
    }
  }
  return { checked: due.length, sent }
}

/** What the SLA check needs: the last successful (or partly successful) run and the run going now. */
export async function slaFacts(workspaceId: string, pipelineId: string, configuredAt: Date, now = new Date()) {
  const scope = and(eq(executionLogs.pipelineId, pipelineId), eq(executionLogs.workspaceId, workspaceId))
  const [success] = await db
    .select({ at: executionLogs.endTime })
    .from(executionLogs)
    .where(and(scope, inArray(executionLogs.status, ['success', 'partial']), isNotNull(executionLogs.endTime)))
    .orderBy(desc(executionLogs.endTime))
    .limit(1)
  const [running] = await db
    .select({ id: executionLogs.id, startTime: executionLogs.startTime, createdAt: executionLogs.createdAt })
    .from(executionLogs)
    .where(and(scope, eq(executionLogs.status, 'running')))
    .orderBy(desc(executionLogs.createdAt))
    .limit(1)
  return {
    now,
    lastSuccessAt: success?.at ?? null,
    configuredAt,
    running: running ? { runId: running.id, startedAt: running.startTime ?? running.createdAt } : null,
  }
}

function slaAlert(kind: 'slow' | 'stale', ctx: { pipelineId: string; pipelineName: string; config: PipelineAlerts; facts: Awaited<ReturnType<typeof slaFacts>> }): Alert {
  const { config, facts } = ctx
  if (kind === 'slow') {
    const minutes = Math.round((facts.now.getTime() - facts.running!.startedAt.getTime()) / 60_000)
    return {
      kind,
      level: 'warning',
      title: `${ctx.pipelineName} is taking longer than expected`,
      lines: [`Pipeline: ${ctx.pipelineName}`, `Running for: ${minutes} min (limit ${config.maxDurationMinutes} min)`, `Run: ${facts.running!.runId}`, `Time: ${facts.now.toISOString()}`],
      pipelineId: ctx.pipelineId,
      pipelineName: ctx.pipelineName,
      runId: facts.running!.runId,
      link: pipelineLink(ctx.pipelineId),
      at: facts.now.toISOString(),
    }
  }
  return {
    kind,
    level: 'warning',
    title: `${ctx.pipelineName} has not run successfully for ${config.staleHours} h`,
    lines: [
      `Pipeline: ${ctx.pipelineName}`,
      `Last successful run: ${facts.lastSuccessAt ? facts.lastSuccessAt.toISOString() : 'none yet'}`,
      `Expected: at least every ${config.staleHours} h`,
      `Time: ${facts.now.toISOString()}`,
    ],
    pipelineId: ctx.pipelineId,
    pipelineName: ctx.pipelineName,
    link: pipelineLink(ctx.pipelineId),
    at: facts.now.toISOString(),
  }
}

/** SLA alerts also reach the bell of the people who look after runs (admins, stewards, operators). */
async function notifyOperators(workspaceId: string, alert: Alert, skip: string[]) {
  const people = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), inArray(workspaceMembers.role, ['admin', 'steward', 'operator'])))
  for (const p of people) {
    if (skip.includes(p.userId)) continue
    await notify({ userId: p.userId, workspaceId, level: alert.level, title: alert.title, lines: alert.lines, pipelineId: alert.pipelineId, runId: alert.runId })
  }
}
