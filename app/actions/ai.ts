'use server'

import { isSecretManager } from '@/lib/secrets/types'
import { resolveSecretRefs } from '@/lib/secrets/resolve'
import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { agents, connectorInstalls, dataSources, executionLogs, nexusDatasets, pipelineRunRejects, pipelines, workspaces } from '@/lib/db/schema'
import { requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { decryptCredentials } from '@/lib/security/credentials'
import { masksFor, applyMasks, liveTableAccess } from '@/lib/governance/masking'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import { sampleSource } from '@/lib/agent/sources'
import { AI_PROVIDERS, aiStatus, askModel } from '@/lib/ai/assistant'
import { askPrompt, checkAsk, checkMapping, checkRule, mappingPrompt, rulePrompt, safeSamples, type AskDataset } from '@/lib/ai/prompts'
import { runWidget } from '@/lib/analytics/run'
import type { DatasetColumn } from '@/lib/analytics/query'
import { guard } from '@/lib/server-action'
import { checkConnectorAnswer, connectorPrompt, detectConnectors, scrubPasted, type ConnectorSuggestion } from '@/lib/ai/discovery'
import { CONNECTOR_CATALOG } from '@/lib/connectors/catalog'
import { applyFix, checkDiagnosis, checkPipelinePlan, diagnosisPrompt, pipelinePrompt, redactMessage, FIX_KINDS, type PlanSource } from '@/lib/ai/pipelines'
import { definitionSchema, scheduleSchema, stepTitle, DEFAULT_SCHEDULE, SEVERITIES, TRANSFORMS, type PipelineNode } from '@/lib/pipelines/definition'
import { savePipelineAs } from '@/lib/pipelines/publish'
import type { SchemaScanResult } from '@/lib/connectors/types'

/**
 * AI assistant (#14) on an open-source model: mapping suggestions, business
 * rules from plain language, and questions about datasets answered with a
 * chart. The model only proposes; people review before saving, and questions
 * run through the same governed query builder as Analytics (masks, row
 * filters, read-only). Personal and sensitive columns never send sample values.
 */

async function getAiSettingsImpl() {
  const ctx = await requireWorkspace()
  const status = await aiStatus(ctx.workspaceId)
  const agentModels = ctx.role === 'admin'
    ? (await db.select({ id: agents.id, name: agents.name, ai: agents.ai }).from(agents).where(and(eq(agents.workspaceId, ctx.workspaceId), isNull(agents.revokedAt)))).map((a) => ({ id: a.id, name: a.name, model: (a.ai as { model?: string } | null)?.model ?? null }))
    : []
  return { ...status, agentModels }
}

const providerInput = z.object({ provider: z.enum(AI_PROVIDERS), agentId: z.string().trim().max(100).nullable().default(null) })

async function setAiProviderImpl(input: z.input<typeof providerInput>) {
  const ctx = await requireWorkspace('workspace:manage')
  const data = providerInput.parse(input)
  if (data.provider === 'agent') {
    if (!data.agentId) throw new Error('Choose the agent whose model to use.')
    const [agent] = await db.select({ id: agents.id }).from(agents).where(and(eq(agents.id, data.agentId), eq(agents.workspaceId, ctx.workspaceId), isNull(agents.revokedAt))).limit(1)
    if (!agent) throw new Error('Agent not found')
  }
  const [before] = await db.select({ provider: workspaces.aiProvider, agentId: workspaces.aiAgentId }).from(workspaces).where(eq(workspaces.id, ctx.workspaceId)).limit(1)
  const after = { provider: data.provider, agentId: data.provider === 'agent' ? data.agentId : null }
  await db.update(workspaces).set({ aiProvider: after.provider, aiAgentId: after.agentId, updatedAt: new Date() }).where(eq(workspaces.id, ctx.workspaceId))
  await recordAudit(ctx, { action: 'UPDATE_POLICY', resource: 'workspace', resourceId: ctx.workspaceId, changes: { aiProvider: after.provider }, diff: diffObjects(before ?? {}, after) })
  revalidatePath('/dashboard', 'layout')
}

// ── Mapping suggestions ──────────────────────────────────────────────────────

const mappingInput = z.object({
  /** Columns arriving at the Map step. */
  columns: z.array(z.object({ name: z.string().min(1).max(200), type: z.string().max(40) })).min(1).max(300),
  /** Where they come from, to show the model a few (non-personal) example values. */
  dataSourceId: z.string().max(100).optional(),
  table: z.string().max(300).optional(),
  /** Target entity of the Unified Data Model (e.g. employee); omitted = free names. */
  entity: z.string().max(60).nullable().default(null),
  /** Target names already used in the step. */
  mapped: z.array(z.string().max(200)).max(300).default([]),
})

async function suggestMappingImpl(input: z.input<typeof mappingInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const data = mappingInput.parse(input)
  let samples: Record<string, unknown>[] = []
  if (data.dataSourceId && data.table) {
    const [source] = await db.select().from(dataSources).where(and(eq(dataSources.id, data.dataSourceId), eq(dataSources.workspaceId, ctx.workspaceId))).limit(1)
    if (source) {
      try {
        const res = await sampleSource(source, await resolveSecretRefs(ctx.workspaceId, decryptCredentials(source.id, source.credentials)), data.table, 5)
        const rows = (res.rows ?? []) as Record<string, unknown>[]
        const { masks } = await liveTableAccess(ctx.workspaceId, null, ctx.role, data.columns.map((c) => c.name))
        samples = applyMasks(rows, masks)
      } catch {
        // Examples are optional; names and types are enough.
      }
    }
  }
  const entity = data.entity ? DOMAIN_BY_NAME.get(data.entity) : null
  const targetFields = entity ? entity.fields.map((f) => ({ name: f.name, type: f.type === 'json' ? 'json' : f.type, label: f.label })) : null
  const sourceColumns = data.columns.map((c) => ({ ...c, samples: safeSamples(c.name, samples.map((r) => r[c.name])) }))
  const { value, model } = await askModel(ctx, 'mapping', mappingPrompt({ sourceColumns, targetFields, mapped: data.mapped }), (answer) => checkMapping(answer, { sourceColumns: data.columns, targetFields, mapped: data.mapped }))
  return { suggestions: value, model }
}

// ── Rules from plain language ────────────────────────────────────────────────

const ruleInput = z.object({
  text: z.string().trim().min(5, 'Describe the rule in a sentence or two').max(2000),
  /** Dataset whose columns the rule uses (the editor's test dataset). */
  dataset: z.string().max(63).optional(),
})

async function draftRuleImpl(input: z.input<typeof ruleInput>) {
  const ctx = await requireWorkspace('rules:edit')
  const data = ruleInput.parse(input)
  let fields: { name: string; type: string }[] = []
  if (data.dataset) {
    const [ds] = await db.select({ columns: nexusDatasets.columns }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, data.dataset))).limit(1)
    fields = ((ds?.columns as DatasetColumn[]) ?? []).map((c) => ({ name: c.name, type: c.type }))
  }
  const { value, model } = await askModel(ctx, 'rule', rulePrompt({ text: data.text, fields }), (answer) => checkRule(answer, { fields }))
  return { ...value, model }
}

// ── Questions about datasets ─────────────────────────────────────────────────

const askInput = z.object({
  question: z.string().trim().min(3, 'Ask a question').max(500),
  /** Limit to one dataset; omitted = the model picks among all. */
  dataset: z.string().max(63).optional(),
})

async function askDataImpl(input: z.input<typeof askInput>) {
  const ctx = await requireWorkspace('data:preview')
  const data = askInput.parse(input)
  const rows = await db
    .select({ name: nexusDatasets.name, columns: nexusDatasets.columns, rowCount: nexusDatasets.rowCount })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), ...(data.dataset ? [eq(nexusDatasets.name, data.dataset)] : [])))
    .orderBy(nexusDatasets.name)
    .limit(40)
  if (!rows.length) throw new Error(data.dataset ? `Dataset ${data.dataset} not found.` : 'There are no datasets yet. Run a pipeline first.')
  // Schema only: names, types and row counts; columns masked for this role are marked and can't be used.
  const datasets: AskDataset[] = await Promise.all(
    rows.map(async (d) => {
      const masked = new Set(Object.keys(await masksFor(ctx.workspaceId, d.name, ctx.role)))
      return { name: d.name, rowCount: d.rowCount ?? 0, columns: ((d.columns as DatasetColumn[]) ?? []).map((c) => ({ name: c.name, type: c.type, ...(masked.has(c.name) ? { masked: true } : {}) })) }
    })
  )
  const { value, model } = await askModel(ctx, 'ask', askPrompt({ question: data.question, datasets, today: new Date().toISOString().slice(0, 10) }), (answer) => checkAsk(answer, { datasets }))
  const result = await runWidget(ctx, value.widget)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dataset', resourceId: value.widget.dataset, changes: { what: 'ai_question', groups: result.rows.length } })
  return { widget: value.widget, explanation: value.explanation, result, model }
}

// ── AI-2: pipeline drafts from a description ─────────────────────────────────

const pipelineInput = z.object({ text: z.string().trim().min(10, 'Describe the pipeline in a sentence or two').max(2000) })

/** A draft pipeline for the editor. Nothing is saved: the person reviews it there and saves it themselves. */
async function draftPipelineImpl(input: z.input<typeof pipelineInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const data = pipelineInput.parse(input)
  const [sourceRows, datasetRows] = await Promise.all([
    db.select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config }).from(dataSources).where(eq(dataSources.workspaceId, ctx.workspaceId)).orderBy(dataSources.name),
    db.select({ name: nexusDatasets.name, columns: nexusDatasets.columns }).from(nexusDatasets).where(eq(nexusDatasets.workspaceId, ctx.workspaceId)).orderBy(nexusDatasets.name),
  ])
  // Schema only (names and types), never sample values.
  const sources: PlanSource[] = sourceRows.filter((r) => !isSecretManager(r.sourceType)).map((r) => {
    const config = (r.config ?? {}) as { role?: 'source' | 'destination'; schemaScan?: SchemaScanResult }
    return {
      id: r.id,
      name: r.name,
      sourceType: r.sourceType,
      role: config.role ?? 'source',
      tables: (config.schemaScan?.tables ?? []).slice(0, 60).map((t) => ({ name: t.name, columns: t.columns.slice(0, 80).map((c) => ({ name: c.name, type: c.type })) })),
    }
  })
  if (!sources.some((x) => x.role === 'source' && x.tables.length)) throw new Error('Connect and scan a data source first: the assistant plans pipelines from your real tables.')
  const datasets = datasetRows.map((d) => ({ name: d.name, columns: ((d.columns as DatasetColumn[]) ?? []).map((c) => ({ name: c.name, type: c.type })) }))
  const { value, model } = await askModel(ctx, 'pipeline', pipelinePrompt({ text: data.text, sources, datasets }), (answer) => checkPipelinePlan(answer, { sources, datasets }))
  return { ...value, model }
}

// ── AI-3: run error diagnosis ────────────────────────────────────────────────

/** One line per step: what it does, never data. */
function describeNode(n: PipelineNode): string {
  switch (n.type) {
    case 'source':
      return `reads ${n.table} (${n.mode})`
    case 'filter':
      return n.conditions.map((c) => `${c.field} ${c.operator} ${c.value}`).join(n.match === 'all' ? ' AND ' : ' OR ') || '(rule)'
    case 'map':
      return n.fields
        .map((f) => `${f.from}→${f.to}:${f.type}${f.transforms.length ? ` [${f.transforms.map((t) => [t.fn, ...(t.args ?? [])].join(' ')).join(', ')}]` : ''}`)
        .join('; ')
        .slice(0, 1500)
    case 'validate':
      return n.rules.map((r) => `${r.field}:${r.rule}${r.value ? `(${r.value})` : ''}[${r.severity}]`).join('; ').slice(0, 1500)
    case 'rules':
      return `${n.ruleIds.length} business rule(s)`
    case 'router':
      return n.branches.map((b) => b.label).join(', ')
    case 'join':
      return `${n.joinType} join on ${n.keys.map((k) => `${k.left}=${k.right}`).join(', ')}`
    case 'union':
      return `stacks its inputs${n.sourceColumn ? ` (input in ${n.sourceColumn})` : ''}`
    case 'aggregate':
      return `groups by ${[...n.groupBy, ...(n.timeGrain ? [`${n.timeGrain.column}/${n.timeGrain.grain}`] : [])].join(', ') || 'all rows'}: ${n.measures.map((m) => `${m.name}=${m.fn}(${m.column})${m.condition ? ' where …' : ''}`).join('; ')}`.slice(0, 1500)
    case 'dedupe':
      return `one row per ${n.keys.join(', ')}, keeps the ${n.keep.replace('_', ' ')}${n.recentBy ? ` by ${n.recentBy}` : ''}`
    case 'enrich':
      return `asks ${n.method} ${n.path} (${n.mode}) for ${n.answer.fields.map((f) => f.as).join(', ') || 'nothing yet'}`
    case 'apicall':
      return `changes data: ${n.create.method} ${n.create.path}${n.update ? `, update ${n.update.method} ${n.update.path}` : ''}; keeps ${n.answer.fields.map((f) => f.as).join(', ') || 'no answer values'}`
    case 'destination':
      return n.kind === 'dataset' ? `dataset ${n.datasetName} (${n.mode})` : n.kind === 'api' ? `API request ${n.method} ${n.path}` : `table ${n.table} (${n.mode})`
  }
}

const diagnoseInput = z.object({ runId: z.string().min(1).max(100) })

/** Explains a failed run (or one that held rows back) and may propose a fix to apply as a draft. */
async function diagnoseRunImpl(input: z.input<typeof diagnoseInput>) {
  const ctx = await requireWorkspace('pipelines:run')
  const { runId } = diagnoseInput.parse(input)
  const [run] = await db.select().from(executionLogs).where(and(eq(executionLogs.id, runId), eq(executionLogs.workspaceId, ctx.workspaceId))).limit(1)
  if (!run) throw new Error('Run not found.')
  if (run.status === 'success' || run.status === 'running') throw new Error('Only failed runs and runs that held rows back can be diagnosed.')
  const [pipeline] = await db.select().from(pipelines).where(and(eq(pipelines.id, run.pipelineId), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
  if (!pipeline) throw new Error('The pipeline was deleted.')
  const definition = definitionSchema.parse(pipeline.draftConfig ?? pipeline.config)
  const titles = new Map(definition.nodes.map((n) => [n.id, stepTitle(n)]))
  const firstMessage = sql<string>`${pipelineRunRejects.errors}->'messages'->>0`
  const problems = await db
    .select({ nodeId: pipelineRunRejects.nodeId, message: firstMessage, n: sql<number>`count(*)::int` })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.workspaceId, ctx.workspaceId), eq(pipelineRunRejects.runId, runId)))
    .groupBy(pipelineRunRejects.nodeId, firstMessage)
    .orderBy(desc(sql`count(*)`))
    .limit(15)
  const details = (run.executionDetails ?? {}) as { steps?: { id: string; label: string; rowsIn: number; rowsOut: number; rejected: number }[] }
  const { value, model } = await askModel(
    ctx,
    'diagnosis',
    diagnosisPrompt({
      pipeline: pipeline.name,
      status: run.status,
      error: run.errorMessage ? redactMessage(run.errorMessage) : null,
      steps: definition.nodes.map((n) => ({ id: n.id, title: stepTitle(n), type: n.type, detail: describeNode(n) })),
      stats: (details.steps ?? []).map((st) => ({ step: st.label, rowsIn: st.rowsIn, rowsOut: st.rowsOut, rejected: st.rejected })),
      problems: problems.filter((p) => p.message).map((p) => ({ message: redactMessage(p.message), count: p.n, step: (p.nodeId && titles.get(p.nodeId)) || '' })),
    }),
    (answer) => checkDiagnosis(answer, { definition }),
  )
  return { ...value, model, pipelineId: pipeline.id, stepTitles: Object.fromEntries(titles) }
}

const fixInput = z.object({
  pipelineId: z.string().min(1).max(100),
  fix: z.object({
    kind: z.enum(FIX_KINDS),
    stepId: z.string().max(100).optional(),
    field: z.string().max(128).optional(),
    transform: z.object({ fn: z.enum(TRANSFORMS), args: z.array(z.string().max(200)).max(4).default([]) }).optional(),
    rule: z.string().max(40).optional(),
    severity: z.enum(SEVERITIES).optional(),
  }),
})

/** Applies a diagnosis fix as a new draft version (never published); the person reviews and publishes it. */
async function applyDiagnosisFixImpl(input: z.input<typeof fixInput>) {
  const ctx = await requireWorkspace('pipelines:edit')
  const data = fixInput.parse(input)
  if (data.fix.kind === 'none') throw new Error('This diagnosis has no fix to apply.')
  const [pipeline] = await db.select().from(pipelines).where(and(eq(pipelines.id, data.pipelineId), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
  if (!pipeline) throw new Error('Pipeline not found.')
  const definition = applyFix(definitionSchema.parse(pipeline.draftConfig ?? pipeline.config), data.fix)
  const saved = await savePipelineAs(
    ctx,
    {
      id: pipeline.id,
      name: pipeline.name,
      description: pipeline.description ?? '',
      definition,
      schedule: scheduleSchema.safeParse(pipeline.schedule ?? {}).data ?? DEFAULT_SCHEDULE,
      enabled: pipeline.enabled ?? false,
      changeNote: `AI diagnosis fix: ${data.fix.kind}${data.fix.field ? ` on ${data.fix.field}` : ''}`,
      publish: false,
    },
    { auditExtra: { ai: 'diagnosis_fix', fix: data.fix.kind } },
  )
  revalidatePath('/dashboard', 'layout')
  return saved
}

// ── AI-4: which connector fits? ──────────────────────────────────────────────

const connectorInput = z.object({
  text: z.string().trim().min(3, 'Paste a URL, a file\'s first line or an error message').max(4000),
  /** Rules only (hints under a failed connection test): never waits for a model. */
  rulesOnly: z.boolean().default(false),
})

/**
 * Suggests connectors for a pasted URL, file header or error. Rules answer first; the model
 * (when one is set up) only fills in when they find nothing. Secrets are scrubbed before either.
 */
async function suggestConnectorImpl(input: z.input<typeof connectorInput>) {
  const ctx = await requireWorkspace()
  const data = connectorInput.parse(input)
  const text = scrubPasted(data.text)
  const catalog = CONNECTOR_CATALOG.map((c) => ({ slug: c.slug, name: c.name, category: c.category, description: c.description }))
  let suggestions: ConnectorSuggestion[] = detectConnectors(text, catalog)
  let via: 'rules' | 'ai' = 'rules'
  let model: string | null = null
  if (!suggestions.length && !data.rulesOnly && (await aiStatus(ctx.workspaceId)).ready) {
    const res = await askModel(ctx, 'connector', connectorPrompt({ text, catalog }), (answer) => checkConnectorAnswer(answer, catalog))
    suggestions = res.value
    via = 'ai'
    model = res.model
  }
  const installs = await db.select({ slug: connectorInstalls.connectorSlug, installedAt: connectorInstalls.installedAt }).from(connectorInstalls).where(eq(connectorInstalls.workspaceId, ctx.workspaceId))
  const installed = new Set(installs.filter((i) => i.installedAt).map((i) => i.slug))
  return {
    via,
    model,
    suggestions: suggestions.map((s) => ({ ...s, name: catalog.find((c) => c.slug === s.slug)?.name ?? s.slug, installed: installed.has(s.slug) })),
  }
}

export async function getAiSettings(...args: Parameters<typeof getAiSettingsImpl>) {
  return guard(() => getAiSettingsImpl(...args))
}

export async function setAiProvider(...args: Parameters<typeof setAiProviderImpl>) {
  return guard(() => setAiProviderImpl(...args))
}

export async function suggestMapping(...args: Parameters<typeof suggestMappingImpl>) {
  return guard(() => suggestMappingImpl(...args))
}

export async function draftRule(...args: Parameters<typeof draftRuleImpl>) {
  return guard(() => draftRuleImpl(...args))
}

export async function askData(...args: Parameters<typeof askDataImpl>) {
  return guard(() => askDataImpl(...args))
}

export async function draftPipeline(...args: Parameters<typeof draftPipelineImpl>) {
  return guard(() => draftPipelineImpl(...args))
}

export async function diagnoseRun(...args: Parameters<typeof diagnoseRunImpl>) {
  return guard(() => diagnoseRunImpl(...args))
}

export async function applyDiagnosisFix(...args: Parameters<typeof applyDiagnosisFixImpl>) {
  return guard(() => applyDiagnosisFixImpl(...args))
}

export async function suggestConnector(...args: Parameters<typeof suggestConnectorImpl>) {
  return guard(() => suggestConnectorImpl(...args))
}
