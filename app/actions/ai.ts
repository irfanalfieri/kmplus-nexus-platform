'use server'

import { z } from 'zod'
import { and, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { agents, dataSources, nexusDatasets, workspaces } from '@/lib/db/schema'
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
  revalidatePath('/dashboard')
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
        const res = await sampleSource(source, Object.fromEntries(Object.entries(decryptCredentials(source.id, source.credentials)).map(([k, v]) => [k, v == null ? '' : String(v)])), data.table, 5)
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
