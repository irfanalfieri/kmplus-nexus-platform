import { z } from 'zod'

/**
 * Alerts beyond the bell and email (MN-5): channels (Slack, Microsoft Teams,
 * any webhook), per-pipeline subscribers, SLA alerts (a run taking too long,
 * no successful run for too long) and an error-rate threshold. Pure and
 * client-safe; covered by scripts/engine-tests.ts. Sending is lib/alerts/send.ts.
 */

export const CHANNEL_KINDS = ['slack', 'teams', 'webhook'] as const
export type ChannelKind = (typeof CHANNEL_KINDS)[number]

export const channelInputSchema = z.object({
  name: z.string().trim().min(1, 'Name the channel').max(80),
  kind: z.enum(CHANNEL_KINDS),
  /** The incoming-webhook URL; left out on an update to keep the stored one. */
  url: z.string().trim().max(2000).optional(),
  /** Every pipeline's alerts go here, not only the pipelines that pick it. */
  allPipelines: z.boolean().default(false),
})
export type ChannelInput = z.infer<typeof channelInputSchema>

export const pipelineAlertsSchema = z.object({
  /** Members who get every alert of this pipeline in their bell and by email. */
  subscribers: z.array(z.string().min(1).max(100)).max(50).default([]),
  /** Alert channels for this pipeline (channels set to every pipeline get them anyway). */
  channelIds: z.array(z.string().min(1).max(100)).max(20).default([]),
  /** Alert when more than this % of the rows read are held (the run still finishes). */
  errorRatePercent: z.number().min(0.1).max(100).nullable().default(null),
  /** Alert when a run is still going after this many minutes. */
  maxDurationMinutes: z.number().int().min(5).max(24 * 60).nullable().default(null),
  /** Alert when the pipeline has had no successful run for this many hours. */
  staleHours: z.number().int().min(1).max(24 * 31).nullable().default(null),
})
export type PipelineAlerts = z.infer<typeof pipelineAlertsSchema>
export const NO_PIPELINE_ALERTS: PipelineAlerts = pipelineAlertsSchema.parse({})

export type AlertKind = 'failed' | 'rejects' | 'errorRate' | 'slow' | 'stale' | 'test'
export type AlertLevel = 'error' | 'warning' | 'info'

export interface Alert {
  kind: AlertKind
  level: AlertLevel
  title: string
  lines: string[]
  pipelineId?: string
  pipelineName?: string
  runId?: string
  /** Where to look in Nexus. */
  link?: string
  at: string
}

/** Share of the rows read that were held, in %. */
export const errorRate = (read: number, held: number) => (read > 0 ? (held / read) * 100 : 0)

export function errorRateBreached(cfg: PipelineAlerts, read: number, held: number) {
  return cfg.errorRatePercent !== null && read > 0 && errorRate(read, held) > cfg.errorRatePercent
}

export interface SlaFacts {
  now: Date
  lastSuccessAt: Date | null
  /** When the alerts were set up (the clock for "stale" before the first success). */
  configuredAt: Date
  running: { runId: string; startedAt: Date } | null
}
export interface SlaState {
  /** The run a "slow" alert was sent for. */
  slowRunId?: string
  /** The last success (or setup time) a "stale" alert was sent for. */
  staleSince?: string
}

const SLOW_RECHECK_MS = 10 * 60_000
const STALE_RECHECK_MS = 60 * 60_000

/**
 * Which SLA alerts are due now (each at most once: once per run for "slow",
 * once per missed success for "stale"), the state to keep, and when to look again.
 */
export function slaCheck(cfg: PipelineAlerts, facts: SlaFacts, state: SlaState): { alerts: ('slow' | 'stale')[]; state: SlaState; nextCheckAt: Date | null } {
  const now = facts.now.getTime()
  const alerts: ('slow' | 'stale')[] = []
  const next: SlaState = { ...state }
  const candidates: number[] = []
  if (cfg.maxDurationMinutes !== null) {
    if (facts.running) {
      const due = facts.running.startedAt.getTime() + cfg.maxDurationMinutes * 60_000
      if (state.slowRunId !== facts.running.runId) {
        if (now >= due) {
          alerts.push('slow')
          next.slowRunId = facts.running.runId
          candidates.push(now + SLOW_RECHECK_MS)
        } else candidates.push(due)
      } else candidates.push(now + SLOW_RECHECK_MS)
    } else candidates.push(now + SLOW_RECHECK_MS)
  }
  if (cfg.staleHours !== null) {
    const base = facts.lastSuccessAt ?? facts.configuredAt
    const due = base.getTime() + cfg.staleHours * 3_600_000
    if (state.staleSince === base.toISOString()) candidates.push(now + STALE_RECHECK_MS)
    else if (now >= due) {
      alerts.push('stale')
      next.staleSince = base.toISOString()
      candidates.push(now + STALE_RECHECK_MS)
    } else candidates.push(due)
  }
  return { alerts, state: next, nextCheckAt: candidates.length ? new Date(Math.min(...candidates)) : null }
}

/** A channel URL check before saving: https, and the service's own hosts for Slack and Teams. */
export function channelUrlProblem(kind: ChannelKind, raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return 'Enter a full URL starting with https://'
  }
  if (url.protocol !== 'https:') return 'Only https:// URLs are allowed.'
  const host = url.hostname.toLowerCase()
  if (kind === 'slack' && host !== 'hooks.slack.com') return 'A Slack incoming webhook URL starts with https://hooks.slack.com/'
  if (kind === 'teams' && !/(\.webhook\.office\.com|\.logic\.azure\.com|\.powerplatform\.com|\.azure-api\.net)$/.test(host))
    return 'Use the URL of a Teams Workflows webhook (… .logic.azure.com or … .powerplatform.com) or an Incoming Webhook (… .webhook.office.com)'
  return null
}

const slackEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const LEVEL_MARK: Record<AlertLevel, string> = { error: '🔴', warning: '🟠', info: '🔵' }

/** "Key: value" lines become facts on a Teams card. */
function facts(lines: string[]) {
  return lines.map((line) => {
    const i = line.indexOf(': ')
    return i > 0 && i < 30 ? { title: line.slice(0, i), value: line.slice(i + 2) } : { title: '', value: line }
  })
}

/** The request body for a channel. */
export function channelPayload(kind: ChannelKind, alert: Alert): unknown {
  if (kind === 'slack') {
    const text = `${LEVEL_MARK[alert.level]} *${slackEscape(alert.title)}*\n${alert.lines.map(slackEscape).join('\n')}${alert.link ? `\n<${alert.link}|Open in KMPlus Nexus>` : ''}`
    return { text, unfurl_links: false }
  }
  if (kind === 'teams') {
    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          contentUrl: null,
          content: {
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: alert.title, weight: 'Bolder', size: 'Medium', wrap: true, color: alert.level === 'error' ? 'Attention' : alert.level === 'warning' ? 'Warning' : 'Default' },
              { type: 'FactSet', facts: facts(alert.lines) },
            ],
            actions: alert.link ? [{ type: 'Action.OpenUrl', title: 'Open in KMPlus Nexus', url: alert.link }] : [],
          },
        },
      ],
    }
  }
  return {
    type: 'alert',
    kind: alert.kind,
    level: alert.level,
    title: alert.title,
    lines: alert.lines,
    pipeline: alert.pipelineId ? { id: alert.pipelineId, name: alert.pipelineName ?? null } : null,
    runId: alert.runId ?? null,
    link: alert.link ?? null,
    at: alert.at,
  }
}
