import { z } from 'zod'
import { DEFAULT_SETTINGS, FILTER_OPERATORS, SEVERITIES, TRANSFORMS, definitionSchema, newStepId, scheduleSchema, type PipelineDefinition, type PipelineNode, type PipelineSchedule } from '@/lib/pipelines/definition'
import { PIPELINE_TEMPLATES, buildPipelineTemplate, type PipelineTemplateId } from '@/lib/pipelines/templates'
import { parseCheck } from '@/lib/pipelines/check-messages'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { AnswerError } from './prompts'
import type { ChatMessage } from './llm'

/**
 * AI-2 (pipeline drafts from a description) and AI-3 (run error diagnosis).
 * Pure; covered by scripts/engine-tests.ts. The model never writes a graph:
 * it fills a small plan that Nexus checks against the real sources, tables and
 * columns and turns into a pipeline with the tested templates. A diagnosis may
 * propose one of a few fixes Nexus knows how to apply; the person reviews and
 * the fix is saved as a draft, never published.
 */

type Col = { name: string; type: string }
export interface PlanSource {
  id: string
  name: string
  sourceType: string
  role: 'source' | 'destination'
  tables: { name: string; columns: Col[] }[]
}

// ── AI-2: pipeline drafts ────────────────────────────────────────────────────

const SCHEDULE_KINDS = ['manual', 'hourly', 'daily', 'weekly', 'monthly'] as const

export function pipelinePrompt(input: { text: string; sources: PlanSource[]; datasets: { name: string; columns: Col[] }[] }): ChatMessage[] {
  const sources = input.sources
    .filter((s) => s.role === 'source')
    .map((s) => `- id "${s.id}": ${s.name} (${s.sourceType}); tables: ${s.tables.length ? s.tables.map((t) => `${t.name} [${t.columns.map((c) => c.name).join(', ')}]`).join('; ') : '(not scanned)'}`)
    .join('\n')
  const products = input.sources.filter((s) => s.role === 'destination' && s.sourceType === 'kmplus').map((s) => `- id "${s.id}": ${s.name}`)
  return [
    {
      role: 'system',
      content: `You plan a KMPlus Nexus data pipeline from a description. Answer with one JSON object only:
{"name":"<short name>","description":"<one sentence>","template":"${PIPELINE_TEMPLATES.map((t) => t.id).join('|')}","dataSourceId":"<source id>","table":"<table>","datasetName":"<lowercase_snake_case>","kmplusDestinationId":"<KMPlus product id or empty>","filter":{"match":"all|any","conditions":[{"field":"<source column>","operator":"<operator>","value":"<text>"}]} or null,"schedule":{"type":"${SCHEDULE_KINDS.join('|')}","time":"HH:mm","weekdays":[1,2,3,4,5],"dayOfMonth":1,"minute":0},"explanation":"<one or two sentences>"}
Templates: ${PIPELINE_TEMPLATES.map((t) => `${t.id} = ${t.description}`).join(' | ')}
Data sources (use only these ids, tables and columns):
${sources || '(none)'}
KMPlus products that can receive employees (only for hris-employee): ${products.length ? `\n${products.join('\n')}` : 'none'}
Existing datasets: ${input.datasets.map((d) => d.name).join(', ') || 'none'}.
Filter conditions use SOURCE column names and keep only the rows the description asks for (e.g. active employees). Operators: ${FILTER_OPERATORS.join(', ')}; values are strings; in_list takes "a, b".
Schedule times are Asia/Jakarta (WIB); weekdays 0 = Sunday … 6 = Saturday. Use "manual" when no timing is mentioned.`,
    },
    { role: 'user', content: input.text },
  ]
}

const planSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  template: z.enum(PIPELINE_TEMPLATES.map((t) => t.id) as [PipelineTemplateId, ...PipelineTemplateId[]]),
  dataSourceId: z.string().min(1),
  table: z.string().min(1),
  datasetName: z.string().max(48).optional(),
  kmplusDestinationId: z.string().optional(),
  filter: z
    .object({
      match: z.enum(['all', 'any']).default('all'),
      conditions: z.array(z.object({ field: z.string().min(1), operator: z.enum(FILTER_OPERATORS), value: z.string().default('') })).max(10),
    })
    .nullable()
    .optional(),
  schedule: z
    .object({ type: z.enum(SCHEDULE_KINDS).default('manual'), time: z.string().optional(), weekdays: z.array(z.number().int().min(0).max(6)).optional(), dayOfMonth: z.number().int().min(1).max(28).optional(), minute: z.number().int().min(0).max(59).optional() })
    .optional(),
  explanation: z.string().max(800).optional(),
})
export type PipelinePlan = z.infer<typeof planSchema>

export interface PipelineDraft {
  name: string
  description: string
  definition: PipelineDefinition
  schedule: PipelineSchedule
  notes: string[]
  explanation: string
}

/** Checks the model's plan against the real sources and builds the pipeline it describes. */
export function checkPipelinePlan(answer: unknown, input: { sources: PlanSource[]; datasets: { name: string; columns: Col[] }[] }): PipelineDraft {
  const parsed = planSchema.safeParse(answer)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new AnswerError(`The plan is invalid at ${issue?.path.join('.') || 'root'}: ${issue?.message ?? 'invalid'}.`)
  }
  const plan = parsed.data
  const source = input.sources.find((s) => s.id === plan.dataSourceId && s.role === 'source')
  if (!source) throw new AnswerError(`Unknown data source "${plan.dataSourceId}". Use one of: ${input.sources.filter((s) => s.role === 'source').map((s) => s.id).join(', ')}.`)
  const table = source.tables.find((t) => t.name === plan.table)
  if (!table) throw new AnswerError(`Table "${plan.table}" is not in ${source.name}. Use one of: ${source.tables.map((t) => t.name).join(', ')}.`)
  const known = new Set(table.columns.map((c) => c.name))
  const unknown = (plan.filter?.conditions ?? []).map((c) => c.field).filter((f) => !known.has(f))
  if (unknown.length) throw new AnswerError(`Filter column(s) ${[...new Set(unknown)].join(', ')} are not in ${plan.table}. Use only: ${[...known].join(', ')}.`)
  let kmplus = plan.kmplusDestinationId || undefined
  if (kmplus) {
    const dest = input.sources.find((s) => s.id === kmplus && s.role === 'destination' && s.sourceType === 'kmplus')
    if (!dest) throw new AnswerError(`"${kmplus}" is not a KMPlus product destination. Leave kmplusDestinationId empty or use a listed product id.`)
    if (plan.template !== 'hris-employee') kmplus = undefined
  }
  const schedule = scheduleSchema.safeParse({ ...(plan.schedule ?? { type: 'manual' }), timezone: 'Asia/Jakarta' })
  if (!schedule.success) throw new AnswerError('The schedule is invalid: time must be "HH:mm", weekdays 0–6, dayOfMonth 1–28.')

  const built = buildPipelineTemplate(plan.template, {
    dataSourceId: source.id,
    sourceType: source.sourceType,
    table: table.name,
    columns: table.columns,
    datasetName: plan.datasetName,
    datasets: input.datasets,
    kmplusDestinationId: kmplus,
  })
  let { nodes, edges } = built
  const conditions = plan.filter?.conditions ?? []
  if (conditions.length) {
    // Filter right after the source, on source columns; later steps shift right.
    const src = nodes.find((n) => n.type === 'source')!
    const filter: PipelineNode = {
      id: newStepId(),
      type: 'filter',
      position: { x: src.position.x + 300, y: src.position.y },
      match: plan.filter?.match ?? 'all',
      conditions: conditions.map((c) => ({ field: c.field, operator: c.operator, value: c.value, valueField: '' })),
      ruleId: '',
    }
    nodes = [...nodes.map((n) => (n.id === src.id ? n : { ...n, position: { ...n.position, x: n.position.x + 300 } })), filter]
    edges = [...edges.map((e) => (e.from === src.id ? { ...e, from: filter.id } : e)), { id: newStepId(), from: src.id, to: filter.id, branch: '' }]
  }
  const definition = definitionSchema.safeParse({ schemaVersion: 2, nodes, edges, settings: DEFAULT_SETTINGS })
  if (!definition.success) throw new AnswerError(`The plan does not make a valid pipeline: ${definition.error.issues[0]?.message ?? 'invalid'}.`)
  return {
    name: plan.name,
    description: plan.description?.trim() || built.description,
    definition: definition.data,
    schedule: schedule.data,
    notes: built.notes,
    explanation: plan.explanation?.trim() ?? '',
  }
}

// ── AI-3: run error diagnosis ────────────────────────────────────────────────

/** Check messages a model may read: values of personal or sensitive fields are replaced by <hidden>. */
export function redactMessage(text: string): string {
  const hit = parseCheck(text)
  if (hit) {
    const field = hit.params.field ?? hit.params.key ?? ''
    const sensitive = !field || suggestColumnPolicy(field).classification !== 'public'
    let out = text
    for (const k of ['value', 'otherValue', 'key', 'manager'] as const) {
      const v = hit.params[k]
      if (v && (sensitive || k === 'key' || k === 'manager')) out = out.split(v).join('<hidden>')
    }
    return out
  }
  // Unknown text: hide anything quoted, and long digit runs (IDs, phone numbers).
  return text.replace(/"[^"]*"/g, '"<hidden>"').replace(/\d{6,}/g, '<hidden>')
}

export interface DiagnosisInput {
  pipeline: string
  status: string
  error: string | null
  steps: { id: string; title: string; type: string; detail: string }[]
  stats: { step: string; rowsIn: number; rowsOut: number; rejected: number }[]
  problems: { message: string; count: number; step: string }[]
}

export const FIX_KINDS = ['none', 'add_transform', 'change_severity', 'remove_rule'] as const

export function diagnosisPrompt(input: DiagnosisInput): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You diagnose a failed or partly failed KMPlus Nexus pipeline run for a data steward. Answer with one JSON object only:
{"summary":"<one sentence: what went wrong>","cause":"<the likely cause, plainly>","steps":["<what the person should do>", …],"fix":{"kind":"${FIX_KINDS.join('|')}","stepId":"<step id>","field":"<field>","transform":{"fn":"<transform>","args":["…"]},"rule":"<validation rule>","severity":"${SEVERITIES.join('|')}"}}
Fix kinds Nexus can apply as a draft for review:
- add_transform: add a transform to the Map step field whose target is "field" (e.g. format_date ["yyyy-MM-dd","dd/MM/yyyy"] when dates arrive as 31/12/1990). Transforms: ${TRANSFORMS.join(', ')}.
- change_severity: set a Validate rule (step, field, rule) to warning or info so rows are written and flagged instead of held.
- remove_rule: remove a Validate rule (step, field, rule) that is wrong for this data.
- none: when the fix belongs in the source system, credentials, or needs a person's judgement.
Prefer fixing data shape (add_transform) over weakening checks. Never suggest removing required, nik, npwp or unique checks on identifiers. Values shown as <hidden> are personal data and are not available.`,
    },
    {
      role: 'user',
      content: JSON.stringify({ pipeline: input.pipeline, runStatus: input.status, runError: input.error, steps: input.steps, stepStats: input.stats, heldRowProblems: input.problems }),
    },
  ]
}

const fixSchema = z.object({
  kind: z.enum(FIX_KINDS).default('none'),
  stepId: z.string().optional(),
  field: z.string().optional(),
  transform: z.object({ fn: z.enum(TRANSFORMS), args: z.array(z.string()).max(4).default([]) }).optional(),
  rule: z.string().optional(),
  severity: z.enum(SEVERITIES).optional(),
})
export type DiagnosisFix = z.infer<typeof fixSchema>
const diagnosisSchema = z.object({
  summary: z.string().trim().min(1).max(400),
  cause: z.string().max(800).default(''),
  steps: z.array(z.string().max(300)).max(6).default([]),
  fix: fixSchema.optional(),
})
export type Diagnosis = { summary: string; cause: string; steps: string[]; fix: DiagnosisFix }

const PROTECTED_RULES = new Set(['required', 'nik', 'npwp', 'unique'])

/** Checks a diagnosis; a proposed fix must apply cleanly to the pipeline it is for. */
export function checkDiagnosis(answer: unknown, input: { definition: PipelineDefinition }): Diagnosis {
  const parsed = diagnosisSchema.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"summary","cause","steps":[…],"fix":{"kind",…}}.')
  const fix = parsed.data.fix ?? { kind: 'none' as const }
  if (fix.kind !== 'none') {
    if (fix.kind === 'remove_rule' && fix.rule && PROTECTED_RULES.has(fix.rule)) throw new AnswerError(`Do not remove ${fix.rule} checks; propose add_transform or none.`)
    try {
      applyFix(input.definition, fix)
    } catch (err) {
      throw new AnswerError(err instanceof Error ? err.message : 'The fix does not apply.')
    }
  }
  return { summary: parsed.data.summary, cause: parsed.data.cause, steps: parsed.data.steps, fix }
}

/** Applies a diagnosis fix to a definition (returns a new one). Throws when it doesn't fit. */
export function applyFix(def: PipelineDefinition, fix: DiagnosisFix): PipelineDefinition {
  if (fix.kind === 'none') return def
  const field = fix.field ?? ''
  if (fix.kind === 'add_transform') {
    if (!fix.transform) throw new Error('add_transform needs "transform".')
    const map = def.nodes.find((n) => n.type === 'map' && (!fix.stepId || n.id === fix.stepId) && n.fields.some((f) => f.to === field))
    if (!map || map.type !== 'map') throw new Error(`No Map step maps a field to "${field}".`)
    const nodes = def.nodes.map((n) =>
      n.id !== map.id || n.type !== 'map' ? n : { ...n, fields: n.fields.map((f) => (f.to === field ? { ...f, transforms: [...f.transforms, { fn: fix.transform!.fn, args: fix.transform!.args }] } : f)) },
    )
    return definitionSchema.parse({ ...def, nodes })
  }
  const validate = def.nodes.find((n) => n.type === 'validate' && (!fix.stepId || n.id === fix.stepId) && n.rules.some((r) => r.field === field && r.rule === fix.rule))
  if (!validate || validate.type !== 'validate') throw new Error(`No Validate step has a "${fix.rule}" rule on "${field}".`)
  const nodes = def.nodes.map((n) => {
    if (n.id !== validate.id || n.type !== 'validate') return n
    if (fix.kind === 'change_severity') {
      if (!fix.severity || fix.severity === 'error') throw new Error('change_severity needs severity warning or info.')
      return { ...n, rules: n.rules.map((r) => (r.field === field && r.rule === fix.rule ? { ...r, severity: fix.severity! } : r)) }
    }
    const rules = n.rules.filter((r) => !(r.field === field && r.rule === fix.rule))
    if (!rules.length) throw new Error('Removing that rule would leave the Validate step empty.')
    return { ...n, rules }
  })
  return definitionSchema.parse({ ...def, nodes })
}
