import { z } from 'zod'

/**
 * Pipeline definition (stored in pipelines.config and pipeline_versions.config).
 * Declarative JSON only: no user code is ever evaluated. Shared by the UI
 * (client-safe: no server imports here) and the engine.
 *
 * Schema v2 is a graph (PRD PD-1/PD-2): `nodes` connected by `edges`. One
 * Source; rows flow along edges; a Router sends each row down one branch;
 * several Destinations are allowed. Schema v1 (an ordered `steps` list) is
 * converted on read, so stored v1 pipelines keep working.
 */

export const COLUMN_TYPES = ['text', 'integer', 'numeric', 'boolean', 'date', 'timestamp', 'json'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]

// ── Conditions (BR-5: one expression format for filters, routers, rules, validation) ──

export const FILTER_OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'greater_than', 'less_than', 'greater_or_equal', 'less_or_equal',
  'is_empty', 'is_not_empty', 'in_list', 'matches_regex',
] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export const conditionSchema = z.object({
  field: z.string().min(1, 'Choose a field'),
  operator: z.enum(FILTER_OPERATORS),
  value: z.string().default(''),
  /** Compare with another field of the same row instead of a fixed value. */
  valueField: z.string().default(''),
})
export type Condition = z.infer<typeof conditionSchema>

export interface ConditionGroup {
  match: 'all' | 'any'
  conditions: Condition[]
  groups: ConditionGroup[]
}
export const conditionGroupSchema: z.ZodType<ConditionGroup, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.object({
    match: z.enum(['all', 'any']).default('all'),
    conditions: z.array(conditionSchema).default([]),
    groups: z.array(conditionGroupSchema).max(10).default([]),
  })
)

// ── Calculated values (BR-2 "calculate field"): a small JSON expression tree ──

export const EXPR_OPS = ['+', '-', '*', '/', 'concat'] as const
export const EXPR_FNS = ['upper', 'lower', 'trim', 'coalesce', 'round', 'year', 'month', 'days_between', 'today'] as const
export type Expr =
  | { kind: 'field'; name: string }
  | { kind: 'value'; value: string }
  | { kind: 'op'; op: (typeof EXPR_OPS)[number]; left: Expr; right: Expr }
  | { kind: 'fn'; fn: (typeof EXPR_FNS)[number]; args: Expr[] }
export const exprSchema: z.ZodType<Expr, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('field'), name: z.string().min(1) }),
    z.object({ kind: z.literal('value'), value: z.string() }),
    z.object({ kind: z.literal('op'), op: z.enum(EXPR_OPS), left: exprSchema, right: exprSchema }),
    z.object({ kind: z.literal('fn'), fn: z.enum(EXPR_FNS), args: z.array(exprSchema).max(5).default([]) }),
  ])
)

// ── Transforms (MP-4) ──

export const TRANSFORMS = [
  'trim', 'uppercase', 'lowercase', 'titlecase', 'replace', 'regex_replace', 'regex_extract',
  'default_if_empty', 'coalesce', 'prefix', 'suffix', 'substring', 'concat', 'split',
  'format_date', 'round', 'number_format', 'to_number', 'to_boolean', 'hash', 'conditional',
] as const
export type TransformName = (typeof TRANSFORMS)[number]

const transformSchema = z.object({
  fn: z.enum(TRANSFORMS),
  /**
   * Argument(s): replace → [search, replacement]; regex_extract → [pattern, group]; substring → [start, length];
   * concat → [template with {column} placeholders]; split → [separator, index]; format_date → [pattern, inputFormat, timezone];
   * number_format → [decimals, locale]; coalesce → [other columns…]; conditional → [operator, value, then, else].
   */
  args: z.array(z.string()).default([]),
})
export type Transform = z.infer<typeof transformSchema>

// ── Validation (DQ-1, DQ-2) ──

export const VALIDATION_RULES = [
  'required', 'email', 'phone', 'nik', 'npwp', 'unique', 'regex', 'min_length', 'max_length', 'min', 'max', 'one_of',
  'date', 'not_future', 'compare', 'exists_in', 'condition', 'manager',
] as const
export type ValidationRule = (typeof VALIDATION_RULES)[number]
export const SEVERITIES = ['error', 'warning', 'info'] as const
export type Severity = (typeof SEVERITIES)[number]

export const validationRuleSchema = z.object({
  field: z.string().min(1),
  rule: z.enum(VALIDATION_RULES),
  /** regex / min / max / one_of / lengths: the parameter; exists_in: "dataset.column"; manager: the employee key column. */
  value: z.string().default(''),
  /** error: quarantined (not written); warning: written and flagged; info: written, noted. */
  severity: z.enum(SEVERITIES).default('error'),
  /** compare: the other field and operator (e.g. termination_date greater_or_equal hire_date). */
  otherField: z.string().default(''),
  operator: z.enum(FILTER_OPERATORS).default('greater_or_equal'),
  /** condition: a business rule whose condition must hold, or an inline condition. */
  ruleId: z.string().default(''),
  condition: conditionGroupSchema.optional(),
})
export type ValidationRuleSpec = z.infer<typeof validationRuleSchema>

// ── Nodes ──

const position = z.object({ x: z.number(), y: z.number() }).default({ x: 0, y: 0 })

const sourceNode = z.object({
  id: z.string(),
  type: z.literal('source'),
  position,
  dataSourceId: z.string().min(1, 'Choose a data source'),
  table: z.string().min(1, 'Choose a table or object'),
  /** Safety cap on rows read per run. */
  maxRows: z.number().int().min(1).max(1_000_000).default(10_000),
  /** incremental: only rows whose watermark column is greater than the last synced value. */
  mode: z.enum(['full', 'incremental']).default('full'),
  /** Ever-increasing column, e.g. updated_at or an auto-increment id. */
  watermarkColumn: z.string().default(''),
})

const filterNode = z.object({
  id: z.string(),
  type: z.literal('filter'),
  position,
  match: z.enum(['all', 'any']).default('all'),
  conditions: z.array(conditionSchema).default([]),
  /** Keep rows matching this business rule's condition (instead of / in addition to the conditions). */
  ruleId: z.string().default(''),
})

const mapNode = z.object({
  id: z.string(),
  type: z.literal('map'),
  position,
  /** Keep source columns that have no mapping (passed through unchanged). */
  keepUnmapped: z.boolean().default(false),
  fields: z
    .array(
      z.object({
        from: z.string().min(1),
        to: z.string().min(1).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers and underscores'),
        type: z.enum(COLUMN_TYPES).default('text'),
        transforms: z.array(transformSchema).default([]),
      })
    )
    .min(1, 'Map at least one field'),
})

const validateNode = z.object({
  id: z.string(),
  type: z.literal('validate'),
  position,
  /** reject: rows failing an error rule are quarantined; abort: the whole run fails on the first one. */
  onFail: z.enum(['reject', 'abort']).default('reject'),
  rules: z.array(validationRuleSchema).min(1, 'Add at least one rule'),
})

/** Applies business rules (Layer 11) to every row: include/exclude, set/calculate fields, notify, approval, triggers. */
const rulesNode = z.object({
  id: z.string(),
  type: z.literal('rules'),
  position,
  ruleIds: z.array(z.string().min(1)).min(1, 'Choose at least one business rule'),
})

/** Sends each row down the first branch whose condition (or rule) matches, else "otherwise". */
const routerNode = z.object({
  id: z.string(),
  type: z.literal('router'),
  position,
  branches: z
    .array(
      z.object({
        id: z.string().min(1),
        label: z.string().trim().min(1, 'Name the branch').max(60),
        ruleId: z.string().default(''),
        condition: conditionGroupSchema.optional(),
      })
    )
    .min(1, 'Add at least one branch'),
})

const datasetDestination = z.object({
  id: z.string(),
  type: z.literal('destination'),
  position,
  kind: z.literal('dataset'),
  datasetName: z
    .string()
    .min(1, 'Name the dataset')
    .max(48)
    .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, numbers and underscores; start with a letter'),
  mode: z.enum(['append', 'upsert', 'replace']).default('replace'),
  keys: z.array(z.string()).default([]),
  /** Upsert + full read: rows not in this run are marked deleted (PD-6 soft-delete missing). */
  softDeleteMissing: z.boolean().default(false),
})

const datasourceDestination = z.object({
  id: z.string(),
  type: z.literal('destination'),
  position,
  kind: z.literal('datasource'),
  dataSourceId: z.string().min(1, 'Choose a destination data source'),
  table: z.string().min(1, 'Choose the destination table'),
  /** Writing into external databases never truncates. */
  mode: z.enum(['append', 'upsert']).default('append'),
  keys: z.array(z.string()).default([]),
  softDeleteMissing: z.boolean().default(false),
  /** Boolean (set true) or timestamp (set now) column marking deleted rows in your table. */
  softDeleteColumn: z.string().default(''),
})

const destinationNode = z.discriminatedUnion('kind', [datasetDestination, datasourceDestination])

export const nodeSchema = z.union([sourceNode, filterNode, mapNode, validateNode, rulesNode, routerNode, destinationNode])
export type PipelineNode = z.infer<typeof nodeSchema>
/** @deprecated name kept for v1 call sites; a node is a step. */
export type PipelineStep = PipelineNode
export type SourceStep = z.infer<typeof sourceNode>
export type FilterStep = z.infer<typeof filterNode>
export type MapStep = z.infer<typeof mapNode>
export type ValidateStep = z.infer<typeof validateNode>
export type RulesStep = z.infer<typeof rulesNode>
export type RouterStep = z.infer<typeof routerNode>
export type DestinationStep = z.infer<typeof destinationNode>
export type NodeType = PipelineNode['type']

export const edgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  /** Router edges: the branch id, or "otherwise". */
  branch: z.string().default(''),
})
export type PipelineEdge = z.infer<typeof edgeSchema>
export const OTHERWISE = 'otherwise'

export const ALERT_TRIGGERS = ['never', 'failure', 'failure_or_rejects'] as const

export const settingsSchema = z.object({
  /** Extra attempts after a failed run (source/destination errors only). */
  retries: z.number().int().min(0).max(3).default(2),
  /** Wait before the first retry; doubles each attempt. */
  retryDelaySeconds: z.number().int().min(5).max(60).default(15),
  alertOn: z.enum(ALERT_TRIGGERS).default('failure'),
  /** Empty = the pipeline owner's email. */
  alertEmails: z.array(z.string().trim().email('Enter valid email addresses')).max(10).default([]),
  /** Fail the run once it has been going this long (across worker invocations). */
  timeoutMinutes: z.number().int().min(1).max(24 * 60).default(120),
  /** Source rows per chunk. */
  batchSize: z.number().int().min(500).max(20_000).default(5000),
  /** Fail the run when more than this % of rows are quarantined (checked after 100 rows); null = no limit. */
  maxErrorPercent: z.number().min(0).max(100).nullable().default(null),
})
export type PipelineSettings = z.infer<typeof settingsSchema>
export const DEFAULT_SETTINGS: PipelineSettings = settingsSchema.parse({})

const graphSchema = z.object({
  schemaVersion: z.literal(2).default(2),
  nodes: z.array(nodeSchema).min(2, 'A pipeline needs a Source and a Destination'),
  edges: z.array(edgeSchema).default([]),
  settings: settingsSchema.default({}),
})

/** Converts a v1 step list to the v2 graph: a straight chain, laid out left to right. */
export function normalizeDefinition(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw
  const r = raw as { steps?: unknown[]; nodes?: unknown; edges?: unknown; settings?: unknown }
  if (r.nodes || !Array.isArray(r.steps)) return raw
  const nodes = r.steps.map((s, i) => ({ ...(s as object), position: { x: i * 260, y: 80 } }))
  const idOf = (n: unknown) => (n as { id: string }).id
  const edges = nodes.slice(1).map((n, i) => ({ id: `e_${i}`, from: idOf(nodes[i]), to: idOf(n) }))
  return { schemaVersion: 2, nodes, edges, settings: r.settings }
}

export const definitionSchema = z.preprocess(
  normalizeDefinition,
  graphSchema.superRefine((def, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message })
    const ids = new Set<string>()
    for (const n of def.nodes) {
      if (ids.has(n.id)) issue(`Two steps share the id ${n.id}.`)
      ids.add(n.id)
    }
    for (const n of def.nodes) if (n.type === 'filter' && !n.conditions.length && !n.ruleId) issue('A Filter needs a condition or a business rule.')
    const sources = def.nodes.filter((n) => n.type === 'source')
    const destinations = def.nodes.filter((n) => n.type === 'destination')
    if (sources.length !== 1) issue('A pipeline needs exactly one Source.')
    if (!destinations.length) issue('Add at least one Destination.')
    const byId = new Map(def.nodes.map((n) => [n.id, n]))
    for (const e of def.edges) {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to) {
        issue('A connection points to a step that no longer exists.')
        continue
      }
      if (to.type === 'source') issue('Nothing can flow into the Source.')
      if (from.type === 'destination') issue('A Destination is the end of a path; it has no outgoing connections.')
      if (from.type === 'router') {
        if (e.branch !== OTHERWISE && !from.branches.some((b) => b.id === e.branch)) issue(`A connection from router ${from.id} has no branch.`)
      } else if (e.branch) issue('Only Router connections carry a branch.')
    }
    // Every step is reachable from the Source, and the graph has no cycles.
    const source = sources[0]
    if (source) {
      const out = new Map<string, string[]>()
      for (const e of def.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
      const reach = new Set<string>([source.id])
      const stack = [source.id]
      while (stack.length) for (const next of out.get(stack.pop()!) ?? []) if (!reach.has(next)) (reach.add(next), stack.push(next))
      const orphan = def.nodes.find((n) => !reach.has(n.id))
      if (orphan) issue(`"${stepTitle(orphan)}" isn't connected to the Source.`)
      if (!topoOrder(def.nodes, def.edges)) issue('Connections form a loop. Pipelines must flow one way.')
    }
    if (source?.type === 'source' && source.mode === 'incremental' && !source.watermarkColumn.trim()) {
      issue('Incremental sync needs a watermark column (e.g. updated_at).')
    }
    for (const d of destinations) {
      if (d.type !== 'destination') continue
      if (d.mode === 'upsert' && d.keys.length === 0) issue(`${stepTitle(d)}: upsert needs at least one key column.`)
      if (d.softDeleteMissing) {
        if (d.mode !== 'upsert') issue(`${stepTitle(d)}: "mark missing rows deleted" needs upsert mode.`)
        if (source?.type === 'source' && source.mode === 'incremental') issue(`${stepTitle(d)}: "mark missing rows deleted" needs a full read, not incremental.`)
        if (d.kind === 'datasource' && !d.softDeleteColumn.trim()) issue(`${stepTitle(d)}: choose the column that marks deleted rows.`)
      }
    }
  })
)
export type PipelineDefinition = z.infer<typeof graphSchema>

/** Nodes in an order where every node comes after all its inputs; null if there is a cycle. */
export function topoOrder<N extends { id: string }>(nodes: N[], edges: { from: string; to: string }[]): N[] | null {
  const indeg = new Map(nodes.map((n) => [n.id, 0]))
  for (const e of edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const queue = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id)
  const order: N[] = []
  while (queue.length) {
    const id = queue.shift()!
    order.push(byId.get(id)!)
    for (const e of edges) {
      if (e.from !== id) continue
      indeg.set(e.to, indeg.get(e.to)! - 1)
      if (indeg.get(e.to) === 0) queue.push(e.to)
    }
  }
  return order.length === nodes.length ? order : null
}

export function stepTitle(n: PipelineNode): string {
  switch (n.type) {
    case 'source':
      return `Read ${n.table || 'source'}`
    case 'filter':
      return n.ruleId ? 'Filter (rule)' : `Filter (${n.conditions.length} condition${n.conditions.length === 1 ? '' : 's'})`
    case 'map':
      return `Map ${n.fields.length} field${n.fields.length === 1 ? '' : 's'}`
    case 'validate':
      return `Validate (${n.rules.length} rule${n.rules.length === 1 ? '' : 's'})`
    case 'rules':
      return `Business rules (${n.ruleIds.length})`
    case 'router':
      return `Route (${n.branches.length + 1} branches)`
    case 'destination':
      return n.kind === 'dataset' ? `Write dataset ${n.datasetName}` : `Write ${n.table}`
  }
}

/** Distinct business rule ids a definition references. */
export function referencedRuleIds(def: PipelineDefinition): string[] {
  const ids = new Set<string>()
  for (const n of def.nodes) {
    if (n.type === 'filter' && n.ruleId) ids.add(n.ruleId)
    if (n.type === 'rules') n.ruleIds.forEach((id) => ids.add(id))
    if (n.type === 'router') n.branches.forEach((b) => b.ruleId && ids.add(b.ruleId))
    if (n.type === 'validate') n.rules.forEach((r) => r.rule === 'condition' && r.ruleId && ids.add(r.ruleId))
  }
  return [...ids]
}

export const SCHEDULE_TYPES = ['manual', 'hourly', 'daily', 'weekly', 'monthly', 'cron'] as const
export const scheduleSchema = z.object({
  type: z.enum(SCHEDULE_TYPES).default('manual'),
  /** HH:mm (daily/weekly/monthly); minute past the hour for hourly. */
  time: z.string().regex(/^\d{2}:\d{2}$/).default('01:00'),
  minute: z.number().int().min(0).max(59).default(0),
  /** 0 = Sunday … 6 = Saturday */
  weekdays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  dayOfMonth: z.number().int().min(1).max(28).default(1),
  cron: z.string().default(''),
  timezone: z.string().default('Asia/Jakarta'),
})
export type PipelineSchedule = z.infer<typeof scheduleSchema>

export const DEFAULT_SCHEDULE: PipelineSchedule = scheduleSchema.parse({})

export function newStepId() {
  return `s_${Math.random().toString(36).slice(2, 10)}`
}

/** Human-readable first validation error, for UI messages. */
export function describeDefinitionError(error: z.ZodError) {
  const issue = error.issues[0]
  if (!issue) return 'Invalid pipeline definition.'
  return issue.message
}
