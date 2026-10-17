import { z } from 'zod'

/**
 * Event triggers (SC-6): what a pipeline's inbound webhook URL understands
 * besides a plain POST. Pure and client-safe; covered by scripts/engine-tests.ts.
 *
 * - CloudEvents 1.0 (structured `application/cloudevents+json`, batches, or
 *   binary mode with `ce-*` headers): SAP Event Mesh / Advanced Event Mesh,
 *   S/4HANA and SuccessFactors events, Azure Event Grid (CloudEvents schema).
 *   The CloudEvents webhook handshake (OPTIONS + `WebHook-Request-Origin`) is
 *   answered so SAP Event Mesh can register the URL.
 * - Azure Event Grid schema, with its subscription validation handshake.
 * - Microsoft Graph change notifications (`validationToken` handshake,
 *   `clientState` checked against the pipeline's secret).
 *
 * Events can be filtered by type and are de-duplicated by id (senders retry).
 */

export const EVENT_FORMATS = ['auto', 'cloudevents', 'eventgrid', 'graph', 'plain'] as const
export type EventFormat = (typeof EVENT_FORMATS)[number]

export const triggerConfigSchema = z.object({
  /** Which senders to accept; auto recognizes every format below. */
  format: z.enum(EVENT_FORMATS).default('auto'),
  /** Event types that start a run (`*` at the end matches a prefix); empty = every type. */
  eventTypes: z.array(z.string().trim().min(1).max(200)).max(30).default([]),
  /** SHA-256 (hex) of the Microsoft Graph clientState; notifications with another value are refused. */
  clientStateHash: z.string().regex(/^[0-9a-f]{64}$/).nullable().default(null),
})
export type TriggerConfig = z.infer<typeof triggerConfigSchema>
export const DEFAULT_TRIGGER_CONFIG: TriggerConfig = triggerConfigSchema.parse({})

export interface InboundRequest {
  method: string
  /** Lower-case header names. */
  headers: Record<string, string>
  query: Record<string, string>
  body: string
}

export interface InboundEvent {
  id: string | null
  type: string | null
  source: string | null
  subject: string | null
  /** Microsoft Graph only. */
  clientState?: string | null
}

export type Handshake = { status: number; body: string; contentType?: string; headers?: Record<string, string> }

export type Inbound =
  | { kind: 'handshake'; format: Exclude<EventFormat, 'auto' | 'plain'>; response: Handshake }
  | { kind: 'events'; format: Exclude<EventFormat, 'auto'>; events: InboundEvent[] }
  | { kind: 'invalid'; message: string }

const str = (v: unknown) => (typeof v === 'string' && v ? v : typeof v === 'number' ? String(v) : null)
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function cloudEvent(e: Record<string, unknown>): InboundEvent {
  return { id: str(e.id), type: str(e.type), source: str(e.source), subject: str(e.subject) }
}
const isCloudEvent = (e: unknown): e is Record<string, unknown> => isObj(e) && typeof e.specversion === 'string' && typeof e.type === 'string'
const isEventGrid = (e: unknown): e is Record<string, unknown> => isObj(e) && typeof e.eventType === 'string' && 'eventTime' in e

/** Reads an inbound request into a handshake to answer or the events it carries. */
export function parseInbound(req: InboundRequest, format: EventFormat = 'auto'): Inbound {
  const allow = (f: EventFormat) => format === 'auto' || format === f
  const method = req.method.toUpperCase()

  // CloudEvents webhook abuse protection (SAP Event Mesh registers webhooks this way).
  if (method === 'OPTIONS') {
    const origin = req.headers['webhook-request-origin']
    if (origin && allow('cloudevents')) {
      return { kind: 'handshake', format: 'cloudevents', response: { status: 200, body: '', headers: { 'WebHook-Allowed-Origin': origin, 'WebHook-Allowed-Rate': '120', Allow: 'POST, OPTIONS' } } }
    }
    return { kind: 'invalid', message: 'Send POST requests to this URL.' }
  }

  // Microsoft Graph subscription validation: echo the token as text within 10 s.
  if (req.query.validationToken !== undefined && allow('graph')) {
    return { kind: 'handshake', format: 'graph', response: { status: 200, body: req.query.validationToken, contentType: 'text/plain' } }
  }

  // CloudEvents binary mode: attributes in ce-* headers, the body is the data.
  if (req.headers['ce-specversion'] && req.headers['ce-type'] && allow('cloudevents')) {
    return { kind: 'events', format: 'cloudevents', events: [{ id: req.headers['ce-id'] ?? null, type: req.headers['ce-type'], source: req.headers['ce-source'] ?? null, subject: req.headers['ce-subject'] ?? null }] }
  }

  const text = req.body.trim()
  if (!text) return format === 'auto' || format === 'plain' ? { kind: 'events', format: 'plain', events: [] } : { kind: 'invalid', message: 'This URL expects an event in the request body.' }
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    if (format === 'auto' || format === 'plain') return { kind: 'events', format: 'plain', events: [] }
    return { kind: 'invalid', message: 'The request body is not JSON.' }
  }

  const list = Array.isArray(body) ? body : [body]
  if (list.length && list.every(isCloudEvent) && allow('cloudevents')) return { kind: 'events', format: 'cloudevents', events: list.map(cloudEvent) }

  if (list.length && list.every(isEventGrid) && allow('eventgrid')) {
    const validation = list.find((e) => e.eventType === 'Microsoft.EventGrid.SubscriptionValidationEvent')
    if (validation) {
      const code = isObj(validation.data) ? str(validation.data.validationCode) : null
      if (!code) return { kind: 'invalid', message: 'The validation event has no validationCode.' }
      return { kind: 'handshake', format: 'eventgrid', response: { status: 200, body: JSON.stringify({ validationResponse: code }), contentType: 'application/json' } }
    }
    return { kind: 'events', format: 'eventgrid', events: list.map((e) => ({ id: str(e.id), type: str(e.eventType), source: str(e.topic), subject: str(e.subject) })) }
  }

  if (isObj(body) && Array.isArray(body.value) && body.value.every((n) => isObj(n) && 'subscriptionId' in n) && allow('graph')) {
    return {
      kind: 'events',
      format: 'graph',
      events: (body.value as Record<string, unknown>[]).map((n) => ({
        // Graph has no event id: the subscription, resource and change type identify a notification well enough to drop repeats.
        id: [str(n.subscriptionId), str(n.changeType), str(n.resource), str(n.subscriptionExpirationDateTime)].filter(Boolean).join('|') || null,
        type: n.changeType ? `graph.${String(n.changeType)}` : null,
        source: str(n.resource),
        subject: isObj(n.resourceData) ? str(n.resourceData.id) : null,
        clientState: str(n.clientState),
      })),
    }
  }

  if (format !== 'auto' && format !== 'plain') return { kind: 'invalid', message: `The request is not a ${format === 'cloudevents' ? 'CloudEvents' : format === 'eventgrid' ? 'Event Grid' : 'Microsoft Graph'} event.` }
  // Any other JSON: a plain trigger; an "id"/"type" at the top level still filters and de-duplicates.
  const top = isObj(body) ? body : {}
  const id = str(top.eventId) ?? str(top.event_id) ?? str(top.id)
  const type = str(top.eventType) ?? str(top.event_type) ?? str(top.type)
  return { kind: 'events', format: 'plain', events: id || type ? [{ id, type, source: null, subject: null }] : [] }
}

/** `sap.s4.beh.businesspartner.v1.*` matches every Business Partner event; matching ignores case. */
export function typeMatches(patterns: string[], type: string | null) {
  if (!patterns.length) return true
  if (!type) return false
  const t = type.toLowerCase()
  return patterns.some((p) => {
    const q = p.toLowerCase()
    return q.endsWith('*') ? t.startsWith(q.slice(0, -1)) : t === q
  })
}

/** The events that start a run under the pipeline's filter (a plain trigger with no events always does). */
export function acceptedEvents(config: TriggerConfig, inbound: Extract<Inbound, { kind: 'events' }>) {
  if (inbound.format === 'plain' && !inbound.events.length) return { accepted: [] as InboundEvent[], run: !config.eventTypes.length }
  const accepted = inbound.events.filter((e) => typeMatches(config.eventTypes, e.type))
  return { accepted, run: accepted.length > 0 }
}

/** A short description of what started the run, for the run log and audit. */
export function describeEvents(format: Exclude<EventFormat, 'auto'>, events: InboundEvent[]) {
  if (!events.length) return null
  const types = Array.from(new Set(events.map((e) => e.type ?? 'event')))
  const label = format === 'cloudevents' ? 'CloudEvents' : format === 'eventgrid' ? 'Event Grid' : format === 'graph' ? 'Microsoft Graph' : 'event'
  return `${label}: ${types.slice(0, 3).join(', ')}${types.length > 3 ? ` +${types.length - 3}` : ''}${events.length > 1 ? ` (${events.length} events)` : ''}`
}
