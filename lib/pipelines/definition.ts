import { z } from 'zod'

/**
 * Pipeline definition (stored in pipelines.config and pipeline_versions.config).
 * Declarative JSON only: no user code is ever evaluated. Shared by the UI
 * (client-safe: no server imports here) and the engine.
 *
 * Steps run in order: source → (filter | map | validate)* → destination.
 */

export const COLUMN_TYPES = ['text', 'integer', 'numeric', 'boolean', 'date', 'timestamp', 'json'] as const
export type ColumnType = (typeof COLUMN_TYPES)[number]

export const FILTER_OPERATORS = [
  'equals', 'not_equals', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'greater_than', 'less_than', 'is_empty', 'is_not_empty', 'in_list',
] as const
export type FilterOperator = (typeof FILTER_OPERATORS)[number]

export const TRANSFORMS = [
  'trim', 'uppercase', 'lowercase', 'titlecase', 'replace', 'regex_replace',
  'default_if_empty', 'prefix', 'suffix', 'substring', 'format_date', 'round', 'to_number', 'to_boolean',
] as const
export type TransformName = (typeof TRANSFORMS)[number]

export const VALIDATION_RULES = ['required', 'email', 'unique', 'regex', 'min_length', 'max_length', 'min', 'max', 'one_of'] as const
export type ValidationRule = (typeof VALIDATION_RULES)[number]

const transformSchema = z.object({
  fn: z.enum(TRANSFORMS),
  /** Argument(s): replace → [search, replacement]; substring → [start, length]; format_date → [pattern]; etc. */
  args: z.array(z.string()).default([]),
})
export type Transform = z.infer<typeof transformSchema>

const sourceStep = z.object({
  id: z.string(),
  type: z.literal('source'),
  dataSourceId: z.string().min(1, 'Choose a data source'),
  table: z.string().min(1, 'Choose a table or object'),
  /** Safety cap on rows read per run. */
  maxRows: z.number().int().min(1).max(100_000).default(10_000),
})

const filterStep = z.object({
  id: z.string(),
  type: z.literal('filter'),
  match: z.enum(['all', 'any']).default('all'),
  conditions: z
    .array(z.object({ field: z.string().min(1), operator: z.enum(FILTER_OPERATORS), value: z.string().default('') }))
    .min(1, 'Add at least one condition'),
})

const mapStep = z.object({
  id: z.string(),
  type: z.literal('map'),
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

const validateStep = z.object({
  id: z.string(),
  type: z.literal('validate'),
  /** reject: failing rows are skipped and recorded; abort: the whole run fails on the first invalid row. */
  onFail: z.enum(['reject', 'abort']).default('reject'),
  rules: z
    .array(z.object({ field: z.string().min(1), rule: z.enum(VALIDATION_RULES), value: z.string().default('') }))
    .min(1, 'Add at least one rule'),
})

const destinationStep = z.discriminatedUnion('kind', [
  z.object({
    id: z.string(),
    type: z.literal('destination'),
    kind: z.literal('dataset'),
    datasetName: z
      .string()
      .min(1, 'Name the dataset')
      .max(48)
      .regex(/^[a-z][a-z0-9_]*$/, 'Lowercase letters, numbers and underscores; start with a letter'),
    mode: z.enum(['append', 'upsert', 'replace']).default('replace'),
    keys: z.array(z.string()).default([]),
  }),
  z.object({
    id: z.string(),
    type: z.literal('destination'),
    kind: z.literal('datasource'),
    dataSourceId: z.string().min(1, 'Choose a destination data source'),
    table: z.string().min(1, 'Choose the destination table'),
    /** Writing into external databases never truncates. */
    mode: z.enum(['append', 'upsert']).default('append'),
    keys: z.array(z.string()).default([]),
  }),
])

export const stepSchema = z.union([sourceStep, filterStep, mapStep, validateStep, destinationStep])
export type PipelineStep = z.infer<typeof stepSchema>
export type SourceStep = z.infer<typeof sourceStep>
export type FilterStep = z.infer<typeof filterStep>
export type MapStep = z.infer<typeof mapStep>
export type ValidateStep = z.infer<typeof validateStep>
export type DestinationStep = z.infer<typeof destinationStep>

export const definitionSchema = z
  .object({
    schemaVersion: z.literal(1).default(1),
    steps: z.array(stepSchema).min(2),
  })
  .superRefine((def, ctx) => {
    const first = def.steps[0]
    const last = def.steps[def.steps.length - 1]
    if (first?.type !== 'source') ctx.addIssue({ code: 'custom', message: 'The first step must be a Source.' })
    if (last?.type !== 'destination') ctx.addIssue({ code: 'custom', message: 'The last step must be a Destination.' })
    const middle = def.steps.slice(1, -1)
    if (middle.some((s) => s.type === 'source' || s.type === 'destination')) {
      ctx.addIssue({ code: 'custom', message: 'Only one Source and one Destination are allowed.' })
    }
    if (last?.type === 'destination' && last.mode === 'upsert' && last.keys.length === 0) {
      ctx.addIssue({ code: 'custom', message: 'Upsert needs at least one key column.' })
    }
  })
export type PipelineDefinition = z.infer<typeof definitionSchema>

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
