/**
 * P1 backlog features of 2026-10-17 (VC-3 version diff, SC-4 maintenance
 * windows, MN-5 alerts, SC-6 event triggers, DB-3 joins, DB-5 sharing,
 * productivity connectors). Pure; run from scripts/engine-tests.ts.
 */
import assert from 'node:assert/strict'
import { definitionSchema, type PipelineDefinition } from '@/lib/pipelines/definition'
import { diffVersions, mappingChanges } from '@/lib/pipelines/version-diff'
import { channelPayload, channelUrlProblem, errorRateBreached, NO_PIPELINE_ALERTS, pipelineAlertsSchema, slaCheck } from '@/lib/alerts/rules'
import { acceptedEvents, DEFAULT_TRIGGER_CONFIG, describeEvents, parseInbound, triggerConfigSchema, typeMatches, type InboundRequest } from '@/lib/pipelines/events'
import { columnLabel, suggestJoinKeys, widgetSchema } from '@/lib/analytics/definition'
import { buildWidgetSql } from '@/lib/analytics/query'
import { suggestCanonicalField } from '@/lib/domain/model'
import { canSeeDashboard, dashboardSharingSchema, embedCsp, embedFilterValues, embedInputSchema, embedUsable, parseSharing } from '@/lib/analytics/sharing'
import { graphqlErrors, graphqlPaged, graphqlRecords, parseOperations, soapRecords } from '@/lib/connectors/api-records'
import { spreadsheetIdOf } from '@/lib/connectors/drivers/googlesheets'
import { folderIdOf } from '@/lib/connectors/drivers/googledrive'
import { hostKeyFingerprint, pemKey } from '@/lib/connectors/drivers/sftp'
import { activeWindow, holdRun, maintenanceWindowSchema, occurrenceEnd, wibToDate, type MaintenanceWindow } from '@/lib/pipelines/maintenance'

type Test = (name: string, fn: () => void | Promise<void>) => Promise<void>

const at = { x: 0, y: 0 }
const def = (nodes: unknown[], edges: unknown[], settings: object = {}) => definitionSchema.parse({ schemaVersion: 2, nodes, edges, settings }) as PipelineDefinition

export async function backlogTests(test: Test) {
  await test('VC-3 version diff: steps added / removed / changed, field mapping changes, connections, settings and schedule', () => {
    const v1 = def(
      [
        { id: 's', type: 'source', position: at, dataSourceId: 'ds', table: 'employees' },
        { id: 'm', type: 'map', position: at, fields: [{ from: 'PERNR', to: 'employee_code' }, { from: 'ENAME', to: 'full_name' }, { from: 'OLD', to: 'legacy' }] },
        { id: 'f', type: 'filter', position: at, match: 'all', conditions: [{ field: 'status', operator: 'equals', value: 'A' }] },
        { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'people', mode: 'replace' },
      ],
      [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'f' }, { id: 'e3', from: 'f', to: 'd' }],
      { retries: 1 }
    )
    const v2 = def(
      [
        { id: 's', type: 'source', position: { x: 50, y: 50 }, dataSourceId: 'ds', table: 'employees' },
        { id: 'm', type: 'map', position: at, fields: [{ from: 'PERNR', to: 'employee_code', transforms: [{ fn: 'trim', args: [] }] }, { from: 'ENAME', to: 'full_name' }, { from: 'GBDAT', to: 'birth_date', type: 'date' }] },
        { id: 'v', type: 'validate', position: at, rules: [{ field: 'employee_code', rule: 'required' }] },
        { id: 'd', type: 'destination', position: at, kind: 'dataset', datasetName: 'people', mode: 'upsert', keys: ['employee_code'] },
      ],
      [{ id: 'e1', from: 's', to: 'm' }, { id: 'e2', from: 'm', to: 'v' }, { id: 'e3', from: 'v', to: 'd' }],
      { retries: 3 }
    )
    const d = diffVersions({ definition: v1, schedule: { type: 'manual' } }, { definition: v2, schedule: { type: 'cron', cron: '0 6 * * *' } })
    assert.deepEqual(d.steps.map((s) => [s.id, s.status]), [['s', 'same'], ['m', 'changed'], ['v', 'added'], ['d', 'changed'], ['f', 'removed']], 'moving a step is not a change')
    assert.deepEqual(d.steps.find((s) => s.id === 'm')!.mapping, [
      { field: 'employee_code', kind: 'changed', from: 'PERNR (text)', to: 'PERNR (text) + 1 transform' },
      { field: 'birth_date', kind: 'added', to: 'GBDAT (date)' },
      { field: 'legacy', kind: 'removed', from: 'OLD (text)' },
    ])
    const dest = d.steps.find((s) => s.id === 'd')!.changes
    assert.ok(dest.some((c) => c.path === 'mode' && c.from === 'replace' && c.to === 'upsert'))
    assert.ok(dest.some((c) => c.path === 'keys' && c.to === '["employee_code"]'))
    assert.equal(d.edges.added.length, 2)
    assert.equal(d.edges.removed.length, 2)
    assert.deepEqual(d.settings.filter((c) => c.path === 'retries'), [{ path: 'retries', from: '1', to: '3' }])
    assert.ok(d.schedule.some((c) => c.path === 'type' && c.from === 'manual' && c.to === 'cron'))
    assert.deepEqual(d.summary, { added: 1, removed: 1, changed: 2, same: 1 })
    // The first version: everything is added.
    assert.ok(diffVersions(null, { definition: v1 }).steps.every((s) => s.status === 'added'))
    assert.deepEqual(mappingChanges([], []), [])
  })

  await test('SC-4 maintenance windows: weekly, overnight, once, per pipeline, back-to-back; defer or skip', () => {
    const win = (id: string, spec: object): MaintenanceWindow => ({ ...maintenanceWindowSchema.parse(spec), id })
    const wib = (local: string) => wibToDate(local)
    // 2026-10-18 is a Sunday.
    const sunday = win('w1', { name: 'HRIS patch', kind: 'weekly', days: [0], startTime: '01:00', endTime: '05:00' })
    assert.equal(occurrenceEnd(sunday, wib('2026-10-18T02:00'))?.toISOString(), wib('2026-10-18T05:00').toISOString())
    assert.equal(occurrenceEnd(sunday, wib('2026-10-18T05:00')), null, 'the end is outside')
    assert.equal(occurrenceEnd(sunday, wib('2026-10-19T02:00')), null, 'Monday is not in it')
    // Overnight: Friday 22:00 – Saturday 04:00.
    const night = win('w2', { name: 'Backup', kind: 'weekly', days: [5], startTime: '22:00', endTime: '04:00', action: 'skip' })
    assert.equal(occurrenceEnd(night, wib('2026-10-16T23:30'))?.toISOString(), wib('2026-10-17T04:00').toISOString())
    assert.equal(occurrenceEnd(night, wib('2026-10-17T03:59'))?.toISOString(), wib('2026-10-17T04:00').toISOString(), "Friday's window spills into Saturday")
    assert.equal(occurrenceEnd(night, wib('2026-10-18T03:00')), null, 'not after Saturday')
    // Blackout dates.
    const yearEnd = win('w3', { name: 'Year-end closing', kind: 'once', startsAt: '2026-12-30T00:00', endsAt: '2027-01-03T00:00', pipelineIds: ['payroll'] })
    assert.equal(holdRun([yearEnd], 'payroll', wib('2026-12-31T12:00')).hold, true)
    assert.equal(holdRun([yearEnd], 'people', wib('2026-12-31T12:00')).hold, false, 'only the chosen pipelines')
    const held = holdRun([sunday, night, yearEnd], 'payroll', wib('2026-10-16T22:30'))
    assert.ok(held.hold && held.action === 'skip' && held.window === 'Backup')
    // Back-to-back: 01:00–05:00 then 05:00–07:00 hold until 07:00.
    const after = win('w4', { name: 'Reindex', kind: 'weekly', days: [0], startTime: '05:00', endTime: '07:00' })
    assert.equal(activeWindow([sunday, after], 'x', wib('2026-10-18T03:00'))?.endsAt.toISOString(), wib('2026-10-18T07:00').toISOString())
    // Validation.
    assert.equal(maintenanceWindowSchema.safeParse({ name: 'x', kind: 'weekly', days: [], startTime: '01:00', endTime: '02:00' }).success, false)
    assert.equal(maintenanceWindowSchema.safeParse({ name: 'x', kind: 'once', startsAt: '2026-10-18T05:00', endsAt: '2026-10-18T04:00' }).success, false)
    assert.equal(maintenanceWindowSchema.safeParse({ name: ' ', kind: 'weekly', days: [1], startTime: '01:00', endTime: '02:00' }).success, false)
  })

  await test('MN-5 alerts: SLA checks fire once (slow per run, stale per missed success), error rate, channel URLs and payloads', () => {
    const cfg = pipelineAlertsSchema.parse({ maxDurationMinutes: 30, staleHours: 24 })
    const t0 = new Date('2026-10-17T00:00:00Z')
    const at = (min: number) => new Date(t0.getTime() + min * 60_000)
    // A run going for 20 min: nothing yet, look again when it reaches 30.
    let r = slaCheck(cfg, { now: at(20), lastSuccessAt: at(-60), configuredAt: at(-600), running: { runId: 'r1', startedAt: at(0) } }, {})
    assert.deepEqual(r.alerts, [])
    assert.equal(r.nextCheckAt?.toISOString(), at(30).toISOString())
    r = slaCheck(cfg, { now: at(31), lastSuccessAt: at(-60), configuredAt: at(-600), running: { runId: 'r1', startedAt: at(0) } }, r.state)
    assert.deepEqual(r.alerts, ['slow'])
    r = slaCheck(cfg, { now: at(45), lastSuccessAt: at(-60), configuredAt: at(-600), running: { runId: 'r1', startedAt: at(0) } }, r.state)
    assert.deepEqual(r.alerts, [], 'once per run')
    // Stale: 24 h after the last success, once until the next success.
    const s1 = slaCheck(cfg, { now: at(25 * 60), lastSuccessAt: at(0), configuredAt: at(-600), running: null }, r.state)
    assert.deepEqual(s1.alerts, ['stale'])
    assert.deepEqual(slaCheck(cfg, { now: at(26 * 60), lastSuccessAt: at(0), configuredAt: at(-600), running: null }, s1.state).alerts, [])
    const s2 = slaCheck(cfg, { now: at(26 * 60), lastSuccessAt: at(25.5 * 60), configuredAt: at(-600), running: null }, s1.state)
    assert.deepEqual(s2.alerts, [], 'a new success resets it')
    assert.ok(s2.nextCheckAt! <= at(26 * 60 + 10), 'no running run: look again soon for the duration limit')
    // Never run: the clock starts when the alert was set up.
    assert.deepEqual(slaCheck(pipelineAlertsSchema.parse({ staleHours: 2 }), { now: at(121), lastSuccessAt: null, configuredAt: at(0), running: null }, {}).alerts, ['stale'])
    assert.equal(slaCheck(NO_PIPELINE_ALERTS, { now: at(0), lastSuccessAt: null, configuredAt: at(0), running: null }, {}).nextCheckAt, null, 'no SLA, no checks')
    // Error rate.
    const er = pipelineAlertsSchema.parse({ errorRatePercent: 5 })
    assert.equal(errorRateBreached(er, 1000, 50), false)
    assert.equal(errorRateBreached(er, 1000, 51), true)
    assert.equal(errorRateBreached(NO_PIPELINE_ALERTS, 10, 10), false)
    // Channel URLs.
    assert.equal(channelUrlProblem('slack', 'https://hooks.slack.com/services/T/B/x'), null)
    assert.match(channelUrlProblem('slack', 'https://example.com/x') ?? '', /hooks\.slack\.com/)
    assert.equal(channelUrlProblem('teams', 'https://prod-01.southeastasia.logic.azure.com/workflows/abc'), null)
    assert.equal(channelUrlProblem('teams', 'https://kmplus.webhook.office.com/webhookb2/abc'), null)
    assert.ok(channelUrlProblem('teams', 'https://evil.example/logic.azure.com'))
    assert.match(channelUrlProblem('webhook', 'http://ops.example.com') ?? '', /https/)
    // Payloads.
    const alert = { kind: 'failed' as const, level: 'error' as const, title: 'Employees <HR> failed', lines: ['Pipeline: Employees', 'Result: timeout'], pipelineId: 'p1', pipelineName: 'Employees', runId: 'r1', link: 'https://nexus.example/dashboard/pipelines', at: t0.toISOString() }
    const slack = channelPayload('slack', alert) as { text: string }
    assert.match(slack.text, /\*Employees &lt;HR&gt; failed\*/)
    assert.match(slack.text, /<https:\/\/nexus\.example\/dashboard\/pipelines\|Open in KMPlus Nexus>/)
    const teams = channelPayload('teams', alert) as { attachments: { content: { body: { type: string; facts?: { title: string; value: string }[]; color?: string }[] } }[] }
    const body = teams.attachments[0].content.body
    assert.equal(body[0].color, 'Attention')
    assert.deepEqual(body[1].facts?.[0], { title: 'Pipeline', value: 'Employees' })
    assert.deepEqual(channelPayload('webhook', alert), { type: 'alert', kind: 'failed', level: 'error', title: alert.title, lines: alert.lines, pipeline: { id: 'p1', name: 'Employees' }, runId: 'r1', link: alert.link, at: alert.at })
  })

  await test('SC-6 event triggers: CloudEvents (structured, batch, binary), SAP Event Mesh / Event Grid / Graph handshakes, filters and plain posts', () => {
    const req = (over: Partial<InboundRequest>): InboundRequest => ({ method: 'POST', headers: {}, query: {}, body: '', ...over })
    // SAP Event Mesh registers the webhook with the CloudEvents handshake.
    const opt = parseInbound(req({ method: 'OPTIONS', headers: { 'webhook-request-origin': 'eventmesh.sap.com' } }))
    assert.ok(opt.kind === 'handshake' && opt.response.headers?.['WebHook-Allowed-Origin'] === 'eventmesh.sap.com')
    // Structured CloudEvent from S/4HANA.
    const ce = { specversion: '1.0', type: 'sap.s4.beh.businesspartner.v1.BusinessPartner.Changed.v1', source: '/default/sap.s4.beh/S4H', id: 'a1b2', time: '2026-10-17T03:00:00Z', data: { BusinessPartner: '1000001' } }
    const one = parseInbound(req({ body: JSON.stringify(ce) }))
    assert.ok(one.kind === 'events' && one.format === 'cloudevents')
    assert.deepEqual(one.events, [{ id: 'a1b2', type: ce.type, source: ce.source, subject: null }])
    const batch = parseInbound(req({ body: JSON.stringify([ce, { ...ce, id: 'c3', type: 'sap.sf.employment.hire.v1' }]) }))
    assert.equal(batch.kind === 'events' && batch.events.length, 2)
    // Binary mode: attributes in headers.
    const bin = parseInbound(req({ headers: { 'ce-specversion': '1.0', 'ce-type': 'sap.sf.employment.hire.v1', 'ce-id': 'x9', 'ce-source': '/sf' }, body: '{"userId":"u1"}' }))
    assert.ok(bin.kind === 'events' && bin.events[0].id === 'x9' && bin.events[0].type === 'sap.sf.employment.hire.v1')
    // Filters: prefix patterns, case-insensitive.
    const cfg = triggerConfigSchema.parse({ eventTypes: ['sap.s4.beh.businesspartner.v1.*'] })
    assert.ok(batch.kind === 'events')
    if (batch.kind === 'events') assert.deepEqual(acceptedEvents(cfg, batch).accepted.map((e) => e.id), ['a1b2'])
    assert.equal(typeMatches(['SAP.SF.*'], 'sap.sf.employment.hire.v1'), true)
    assert.equal(typeMatches(['sap.sf.employment.hire.v1'], 'sap.sf.employment.hire.v2'), false)
    assert.equal(typeMatches([], null), true)
    // Azure Event Grid: validation handshake, then events.
    const eg = parseInbound(req({ body: JSON.stringify([{ id: 'v', eventType: 'Microsoft.EventGrid.SubscriptionValidationEvent', eventTime: '2026-10-17T00:00:00Z', subject: '', data: { validationCode: 'CODE-1' } }]) }))
    assert.ok(eg.kind === 'handshake' && JSON.parse(eg.response.body).validationResponse === 'CODE-1')
    const egEvents = parseInbound(req({ body: JSON.stringify([{ id: 'e1', eventType: 'Microsoft.Storage.BlobCreated', eventTime: '2026-10-17T00:00:00Z', topic: '/subscriptions/x', subject: '/blobs/hr/employees.csv', data: {} }]) }))
    assert.ok(egEvents.kind === 'events' && egEvents.format === 'eventgrid' && egEvents.events[0].subject === '/blobs/hr/employees.csv')
    // Microsoft Graph: validation token echoed as text; notifications carry clientState.
    const g = parseInbound(req({ query: { validationToken: 'tok en' } }))
    assert.ok(g.kind === 'handshake' && g.response.body === 'tok en' && g.response.contentType === 'text/plain')
    const gn = parseInbound(req({ body: JSON.stringify({ value: [{ subscriptionId: 's1', changeType: 'updated', resource: 'users/42', clientState: 'secret', subscriptionExpirationDateTime: '2026-10-20T00:00:00Z', resourceData: { id: '42' } }] }) }))
    assert.ok(gn.kind === 'events' && gn.format === 'graph' && gn.events[0].type === 'graph.updated' && gn.events[0].clientState === 'secret' && gn.events[0].subject === '42')
    // Plain posts still run; a format restriction refuses other bodies.
    const plain = parseInbound(req({ body: '' }))
    assert.ok(plain.kind === 'events' && plain.format === 'plain')
    if (plain.kind === 'events') {
      assert.equal(acceptedEvents(DEFAULT_TRIGGER_CONFIG, plain).run, true)
      assert.equal(acceptedEvents(cfg, plain).run, false, 'a type filter needs a typed event')
    }
    const generic = parseInbound(req({ body: JSON.stringify({ eventId: 'job-7', eventType: 'payroll.closed' }) }))
    assert.ok(generic.kind === 'events' && generic.events[0].id === 'job-7')
    assert.equal(parseInbound(req({ body: '{"hello":1}' }), 'cloudevents').kind, 'invalid')
    assert.equal(parseInbound(req({ method: 'OPTIONS' })).kind, 'invalid')
    assert.equal(describeEvents('cloudevents', one.kind === 'events' ? one.events : []), `CloudEvents: ${ce.type}`)
  })

  await test('DB-3 dashboard joins: one row per key from the joined dataset, masks and row filters on both sides, key suggestions from domain fields', () => {
    const people = [{ name: 'employee_code', type: 'text' }, { name: 'org_code', type: 'text' }, { name: 'hire_date', type: 'date' }]
    const pay = [{ name: 'PERNR', type: 'text' }, { name: 'salary', type: 'numeric' }, { name: 'bank_account', type: 'text' }, { name: 'org_code', type: 'text' }]
    const w = widgetSchema.parse({
      id: 'w1',
      type: 'bar',
      dataset: 'people',
      join: { dataset: 'payroll', left: 'employee_code', right: 'PERNR' },
      measure: { agg: 'avg', column: 'join:salary' },
      dimension: { column: 'org_code' },
      filters: [{ column: 'join:salary', op: 'gt', value: '1000' }],
    })
    const rf = [{ column: 'org_code', operator: 'equals' as const, value: 'HR', roles: ['viewer' as const] }]
    const sql = buildWidgetSql(w, '"nexus_data"."people"', people, { rowFilters: rf, join: { table: '"nexus_data"."payroll"', columns: pay, blockedColumns: ['bank_account'], rowFilters: rf } })
    assert.match(sql.text, /FROM \(SELECT \* FROM "nexus_data"\."people" WHERE "_nexus_deleted_at" IS NULL AND .*\) b LEFT JOIN \(SELECT DISTINCT ON \("PERNR"::text\) \* FROM "nexus_data"\."payroll" WHERE "_nexus_deleted_at" IS NULL AND .* ORDER BY "PERNR"::text, "_nexus_loaded_at" DESC NULLS LAST\) j ON b\."employee_code"::text = j\."PERNR"::text/)
    assert.match(sql.text, /avg\(j\."salary"::numeric\)/)
    assert.match(sql.text, /SELECT b\."org_code"::text AS label/)
    assert.match(sql.text, /WHERE j\."salary"::numeric > \$\d+::numeric/)
    assert.equal(sql.params.filter((p) => p === 'HR').length, 2, 'row filters on both sides')
    // A masked joined column can't be used; a missing one names its dataset.
    assert.throws(() => buildWidgetSql({ ...w, measure: { agg: 'count_distinct', column: 'join:bank_account' } }, 'T', people, { join: { table: 'J', columns: pay, blockedColumns: ['bank_account'] } }), /masked/)
    assert.throws(() => buildWidgetSql({ ...w, measure: { agg: 'sum', column: 'join:bonus' } }, 'T', people, { join: { table: 'J', columns: pay } }), /not in dataset payroll/)
    assert.throws(() => buildWidgetSql(w, 'T', people), /no longer exists/)
    // Inner join, and widgets without a join keep their old SQL.
    assert.match(buildWidgetSql({ ...w, join: { ...w.join!, kind: 'inner' } }, 'T', people, { join: { table: 'J', columns: pay } }).text, /\) b JOIN \(/)
    assert.equal(buildWidgetSql({ ...w, join: null, measure: { agg: 'count', column: '' }, filters: [] }, 'T', people).text, 'SELECT "org_code"::text AS label, count(*) AS value FROM T WHERE "_nexus_deleted_at" IS NULL GROUP BY 1 ORDER BY value DESC NULLS LAST, label ASC LIMIT 13')
    assert.equal(widgetSchema.safeParse({ ...w, join: null }).success, false, 'joined columns need a join')
    assert.equal(widgetSchema.safeParse({ ...w, join: { ...w.join, dataset: 'people' } }).success, false)
    // Key suggestions: PERNR is the employee code; same-name org_code follows.
    assert.deepEqual(suggestJoinKeys(people, pay, (c) => suggestCanonicalField(c)).map((k) => [k.left, k.right]), [['employee_code', 'PERNR'], ['org_code', 'org_code']])
    assert.equal(columnLabel('join:salary', w.join), 'payroll.salary')
  })

  await test('DB-5 dashboard sharing and embeds: who sees a restricted dashboard, embed roles and sites, filters from the embed URL', () => {
    const restricted = dashboardSharingSchema.parse({ mode: 'restricted', roles: ['steward'], userIds: ['u-ana'] })
    const see = (userId: string, role: 'admin' | 'steward' | 'analyst' | 'viewer') => canSeeDashboard(restricted, { userId, role }, 'u-owner')
    assert.equal(see('u-x', 'admin'), true, 'admins always')
    assert.equal(see('u-owner', 'viewer'), true, 'the creator always')
    assert.equal(see('u-x', 'steward'), true)
    assert.equal(see('u-ana', 'viewer'), true)
    assert.equal(see('u-x', 'analyst'), false)
    assert.equal(canSeeDashboard(parseSharing(undefined), { userId: 'u-x', role: 'viewer' }, 'u-owner'), true, 'old dashboards stay workspace-wide')
    // Embeds: no unmasked roles, https sites only (localhost for development).
    assert.equal(embedInputSchema.safeParse({ role: 'admin', allowedOrigins: ['https://kms.kmplus.co.id'] }).success, false)
    assert.equal(embedInputSchema.safeParse({ allowedOrigins: ['http://kms.kmplus.co.id'] }).success, false)
    assert.equal(embedInputSchema.safeParse({ allowedOrigins: [] }).success, false)
    assert.equal(embedInputSchema.safeParse({ allowedOrigins: ['https://*.kmplus.co.id', 'http://localhost:3000'] }).success, true)
    assert.equal(embedCsp(['https://kms.kmplus.co.id', 'javascript:alert(1)']), 'frame-ancestors https://kms.kmplus.co.id')
    assert.equal(embedCsp([]), "frame-ancestors 'none'")
    assert.equal(embedUsable({ revokedAt: null, expiresAt: new Date(Date.now() + 1000) }), true)
    assert.equal(embedUsable({ revokedAt: new Date(), expiresAt: null }), false)
    assert.equal(embedUsable({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) }), false)
    // Filter values from the host app.
    const filters = [
      { id: 'org', label: 'Org', kind: 'value' as const, column: 'org_code' },
      { id: 'hired', label: 'Hired', kind: 'date' as const, column: 'hire_date' },
      { id: 'left', label: 'Left', kind: 'date' as const, column: 'termination_date' },
    ]
    assert.deepEqual(embedFilterValues(filters, { 'f.org': 'HR', 'f.hired': '90d', 'f.left.from': '2026-01-01', 'f.left.to': 'bad', 'f.other': 'x' }), {
      org: { value: 'HR' },
      hired: { preset: '90d' },
      left: { preset: 'custom', from: '2026-01-01', to: undefined },
    })
    assert.deepEqual(embedFilterValues(filters, { 'f.hired': 'forever' }), {}, 'unknown presets are ignored')
  })

  await test('DS-9 GraphQL / SOAP / Sheets / Drive / SFTP helpers: operations, records, paging, faults, IDs from URLs, pasted keys', () => {
    // Operations under ### lines; one unnamed block is "result".
    assert.deepEqual(parseOperations('### Employees\nquery { a }\n\n### Org units\n{ b }\n### empty\n'), [{ name: 'employees', body: 'query { a }' }, { name: 'org_units', body: '{ b }' }])
    assert.deepEqual(parseOperations('{ x }'), [{ name: 'result', body: '{ x }' }])
    // GraphQL: the first list (relay edges unwrapped), its pageInfo.
    const relay = graphqlRecords({ hr: { employees: { edges: [{ node: { code: 'E1', org: { code: 'HR' } }, cursor: 'c1' }], pageInfo: { hasNextPage: true, endCursor: 'c1' } } } })
    assert.deepEqual(relay.rows, [{ code: 'E1', 'org.code': 'HR' }])
    assert.deepEqual(relay.pageInfo, { hasNextPage: true, endCursor: 'c1' })
    assert.equal(relay.path, 'hr.employees.edges')
    assert.deepEqual(graphqlRecords({ me: { id: 1, name: 'A' } }).rows, [{ id: 1, name: 'A' }], 'a single object is one row')
    assert.equal(graphqlPaged('query ($after: String) { x(after: $after) }'), true)
    assert.equal(graphqlErrors({ errors: [{ message: 'Not authorized' }] }), 'Not authorized')
    // SOAP: repeated element found automatically, namespaces ignored, attributes kept, faults are errors.
    const xml = `<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><ns:GetEmployeesResponse xmlns:ns="urn:hr"><ns:Employee id="1"><ns:Code>E1</ns:Code><ns:Org><ns:Code>HR</ns:Code></ns:Org></ns:Employee><ns:Employee id="2"><ns:Code>E2</ns:Code><ns:Org><ns:Code>FIN</ns:Code></ns:Org></ns:Employee></ns:GetEmployeesResponse></soap:Body></soap:Envelope>`
    const soap = soapRecords(xml)
    assert.equal(soap.element, 'Employee')
    assert.deepEqual(soap.rows, [{ '@id': '1', Code: 'E1', 'Org.Code': 'HR' }, { '@id': '2', Code: 'E2', 'Org.Code': 'FIN' }])
    assert.deepEqual(soapRecords(xml, 'ns:Org').rows, [{ Code: 'HR' }, { Code: 'FIN' }], 'a named record element')
    assert.throws(() => soapRecords('<s:Envelope xmlns:s="x"><s:Body><s:Fault><faultcode>s:Client</faultcode><faultstring>Unknown company</faultstring></s:Fault></s:Body></s:Envelope>'), /fault: Unknown company/)
    assert.throws(() => soapRecords('<!DOCTYPE x [<!ENTITY a "b">]><x/>'))
    // IDs from pasted URLs.
    assert.equal(spreadsheetIdOf('https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/edit#gid=0'), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789')
    assert.throws(() => spreadsheetIdOf('not a sheet'), /spreadsheet URL or ID/)
    assert.equal(folderIdOf('https://drive.google.com/drive/folders/0AbCdEfGhIjK123?usp=sharing'), '0AbCdEfGhIjK123')
    // A private key pasted into a one-line field gets its line breaks back.
    assert.equal(pemKey('-----BEGIN OPENSSH PRIVATE KEY----- b3Blbn Nz aC1r -----END OPENSSH PRIVATE KEY-----'), '-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\nNz\naC1r\n-----END OPENSSH PRIVATE KEY-----\n')
    assert.match(hostKeyFingerprint(Buffer.from('key')), /^SHA256:[A-Za-z0-9+/]{43}$/)
  })
}
