import { z } from 'zod'
import { planLanes, type LanePlan } from './lanes'
import { isOutputPath, outputPathIssues } from './nested'

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
  'format_date', 'round', 'number_format', 'to_number', 'to_boolean', 'hash', 'conditional', 'lookup', 'relate',
] as const
export type TransformName = (typeof TRANSFORMS)[number]

const transformSchema = z.object({
  fn: z.enum(TRANSFORMS),
  /**
   * Argument(s): replace → [search, replacement]; regex_extract → [pattern, group]; substring → [start, length];
   * concat → [template with {column} placeholders]; split → [separator, index]; format_date → [pattern, inputFormat, timezone];
   * number_format → [decimals, locale]; coalesce → [other columns…]; conditional → [operator, value, then, else];
   * lookup → [dataset, key column, value column, if not found] (MP-6: e.g. ORG_CODE → org_name from a dataset);
   * relate → [dataset, key column, id column, if not found (quarantine | flag | empty | keep), match (loose | loose_zeros | exact)]
   *   (MP-8: a reference such as MANAGER_NIK → the related record's employee.id; relateArgs in transforms.ts).
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
  /**
   * Several Sources (lanes): the driver streams in chunks; every other lane is
   * staged (read in full first) or streamed after it into a Union. A single
   * Source is the driver implicitly, so this is only set with several.
   */
  driver: z.boolean().optional(),
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
        /** A column, or a path into a nested value (MP-7: address.city, phones.0.number, assignments[].org). */
        from: z.string().min(1),
        /** Dots build a nested object (MP-7: address.city → { address: { city } }). */
        to: z.string().min(1).max(200).refine(isOutputPath, 'Use letters, numbers and underscores (dots build a nested object)'),
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

// ── Several sources (lanes): Join and Union ──

export const JOIN_TYPES = ['left', 'inner', 'no_match'] as const
export type JoinType = (typeof JOIN_TYPES)[number]
export const JOIN_NO_MATCH = ['keep', 'drop', 'quarantine'] as const
export const MAX_SOURCES = 10
/** Rows one staged lane may hold (all the sources feeding one Join's right side). */
export const MAX_STAGED_ROWS = 1_000_000

/**
 * Joins the rows arriving on its left port (the driving side) with the rows of
 * the lane on its right port, which is staged first. Edges into a Join carry
 * `port: 'left' | 'right'`.
 */
const joinNode = z.object({
  id: z.string(),
  type: z.literal('join'),
  position,
  /** left: every left row (unmatched per onNoMatch); inner: matched rows only; no_match: left rows without a partner. */
  joinType: z.enum(JOIN_TYPES).default('left'),
  keys: z
    .array(z.object({ left: z.string().trim().min(1, 'Choose the key column on both sides'), right: z.string().trim().min(1, 'Choose the key column on both sides') }))
    .min(1, 'Choose at least one pair of key columns')
    .max(5),
  /** Key normalization before comparing: " E00123 " = "e00123"; leadingZeros: "00123" = "123". */
  normalize: z.object({ trim: z.boolean().default(true), ignoreCase: z.boolean().default(true), leadingZeros: z.boolean().default(false) }).default({}),
  /** all: one row per match (rows can multiply); first: one partner, picked by firstBy (else the first staged). */
  onMany: z.enum(['all', 'first']).default('all'),
  firstBy: z.object({ column: z.string().default(''), direction: z.enum(['asc', 'desc']).default('desc') }).default({}),
  /** Left rows without a partner: kept with empty right values (left joins), dropped, or quarantined (replayable). */
  onNoMatch: z.enum(JOIN_NO_MATCH).default('keep'),
  /** Right columns whose name the left row already has get this prefix; empty = the right source's table name + "_". */
  prefix: z.string().trim().max(40).regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/, 'Use letters, numbers and underscores').default(''),
})

/** Stacks the rows of its inputs (columns matched by name) and records which input each came from. */
const unionNode = z.object({
  id: z.string(),
  type: z.literal('union'),
  position,
  /** Column that records the input; empty = not recorded. */
  sourceColumn: z.string().trim().max(60).regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/, 'Use letters, numbers and underscores').default('_source'),
  /** Value written for each input (keyed by the step it comes from); default: that lane's table. */
  labels: z.array(z.object({ from: z.string().min(1), label: z.string().trim().max(60) })).max(MAX_SOURCES).default([]),
})

// ── Nested lists (MP-7) ──

/** One row per item of a list (e.g. an employee's assignments[]); the other columns repeat on every row. */
const splitNode = z.object({
  id: z.string(),
  type: z.literal('split'),
  position,
  /** The list: a column or a path into a nested value (employment.assignments). */
  path: z.string().trim().min(1, 'Choose the list to split').max(300),
  /** Column for each item, or the prefix of an object item's fields (`<as>_<field>`); empty = the list's own name. */
  as: z.string().trim().max(40).regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/, 'Use letters, numbers and underscores').default(''),
  /** Object items: their fields become columns (nested ones joined with _). */
  flattenItems: z.boolean().default(true),
  /** Column holding the item's position (1, 2 …); empty = not added. */
  indexColumn: z.string().trim().max(63).regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/, 'Use letters, numbers and underscores').default(''),
  /** A row whose list is empty or missing: kept once (without item values) or dropped. */
  onEmpty: z.enum(['keep', 'drop']).default('keep'),
  /** Leave the list column itself out of the output. */
  dropList: z.boolean().default(true),
  /** Items per row at most; the rest are left out and the row is flagged. */
  maxItems: z.number().int().min(1).max(10_000).default(1000),
})

// ── Blocking steps (they need every row before they can answer): Aggregate, Deduplicate ──

export const AGGREGATE_FNS = ['count', 'count_distinct', 'sum', 'avg', 'min', 'max', 'first', 'last', 'join', 'list'] as const
export type AggregateFn = (typeof AGGREGATE_FNS)[number]
export const TIME_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const
export type TimeGrain = (typeof TIME_GRAINS)[number]
const outputName = z.string().trim().min(1, 'Name every output column').max(63).regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'Use letters, numbers and underscores')

export const aggregateMeasureSchema = z.object({
  name: outputName,
  fn: z.enum(AGGREGATE_FNS).default('count'),
  /** Column the measure reads; count without a column counts rows. */
  column: z.string().default(''),
  /** first / last: the column that orders the group (empty = the order rows were read). */
  sortBy: z.string().default(''),
  /** join: text between values. */
  separator: z.string().max(10).default(', '),
  /** Conditional measure: only rows matching this count (e.g. count where status = Active). */
  condition: conditionGroupSchema.optional(),
})
export type AggregateMeasure = z.infer<typeof aggregateMeasureSchema>

/** One row per group: the group-by values, an optional time bucket and named measures. */
const aggregateNode = z.object({
  id: z.string(),
  type: z.literal('aggregate'),
  position,
  groupBy: z.array(z.string().min(1)).max(10).default([]),
  /** A date or timestamp column bucketed by day … year (the bucket's first day). */
  timeGrain: z.object({ column: z.string().min(1), grain: z.enum(TIME_GRAINS).default('month'), as: z.string().trim().max(63).regex(/^([A-Za-z_][A-Za-z0-9_]*)?$/, 'Use letters, numbers and underscores').default('') }).optional(),
  measures: z.array(aggregateMeasureSchema).min(1, 'Add at least one measure').max(30),
})

export const DEDUPE_KEEP = ['first', 'last', 'most_recent'] as const
/** Keeps one row per key; removed duplicates are listed in Data quality as flags. */
const dedupeNode = z.object({
  id: z.string(),
  type: z.literal('dedupe'),
  position,
  keys: z.array(z.string().min(1)).min(1, 'Choose the key columns').max(5),
  normalize: z.object({ trim: z.boolean().default(true), ignoreCase: z.boolean().default(true), leadingZeros: z.boolean().default(false) }).default({}),
  /** first: the first one read (streams); last / most_recent: need every row (finish phase). */
  keep: z.enum(DEDUPE_KEEP).default('first'),
  /** most_recent: the date or timestamp column that decides. */
  recentBy: z.string().default(''),
  /** List each removed duplicate in Data quality (as a flag; nothing is blocked). */
  flagRemoved: z.boolean().default(true),
})

/** What a column of a defined dataset takes (target-first mapping): a column, a fixed value or an expression. */
export const schemaBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('column'), column: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('constant'), value: z.string().max(2000) }),
  z.object({ kind: z.literal('expr'), expr: exprSchema }),
])
export type SchemaBinding = z.infer<typeof schemaBindingSchema>

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
  /**
   * Defined datasets (lib/datasets/schema.ts): what each schema column takes. Empty = input columns
   * matched by name. The destination writes only the columns it maps (other pipelines may own the rest).
   */
  columnMap: z.array(z.object({ target: z.string().min(1).max(63), binding: schemaBindingSchema })).max(300).optional(),
  /** Extra columns (not in the schema) are left out without asking again ("Drop them and continue"). */
  dropExtra: z.boolean().optional(),
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

// ── REST API destination: the request body built from a pasted sample (lib/pipelines/body-template.ts) ──

export const BODY_FORMATS = ['json', 'form', 'xml'] as const
export type BodyFormat = (typeof BODY_FORMATS)[number]
/** Type a leaf is sent as; "auto" keeps the column's own type. XML and form bodies send text either way. */
export const BODY_VALUE_TYPES = ['auto', 'string', 'number', 'integer', 'boolean'] as const
export type BodyValueType = (typeof BODY_VALUE_TYPES)[number]
/** Run information a leaf can carry (e.g. a batch id the API uses to ignore repeats). */
export const BODY_META = ['run_id', 'batch_id', 'row_count', 'now'] as const
export type BodyMeta = (typeof BODY_META)[number]
export const API_METHODS = ['POST', 'PUT', 'PATCH'] as const

export const bodyBindingSchema = z.discriminatedUnion('kind', [
  /** Not sent (the empty rule decides what the leaf becomes). */
  z.object({ kind: z.literal('none') }),
  z.object({ kind: z.literal('column'), column: z.string().min(1).max(200) }),
  z.object({ kind: z.literal('constant'), value: z.string().max(2000) }),
  z.object({ kind: z.literal('expr'), expr: exprSchema }),
  z.object({ kind: z.literal('meta'), name: z.enum(BODY_META) }),
])
export type BodyBinding = z.infer<typeof bodyBindingSchema>

/**
 * A request body as a tree. Objects keep their key order; XML uses "@name" keys
 * for attributes and "#text" for an element's text. An array's items are either
 * one per row of the request ("rows": batch mode, at most one such array, not
 * inside another array) or one item from the current row ("row"). Phase 2 adds
 * items built by grouping rows by a key, as another `items` value.
 */
export type BodyNode =
  | { t: 'object'; fields: { key: string; node: BodyNode }[] }
  | { t: 'array'; items: 'rows' | 'row'; item: BodyNode }
  | { t: 'value'; type: BodyValueType; binding: BodyBinding; required: boolean; empty: 'null' | 'omit' | 'empty' }
export const bodyNodeSchema: z.ZodType<BodyNode, z.ZodTypeDef, unknown> = z.lazy(() =>
  z.discriminatedUnion('t', [
    z.object({ t: z.literal('object'), fields: z.array(z.object({ key: z.string().min(1).max(200), node: bodyNodeSchema })).max(300) }),
    z.object({ t: z.literal('array'), items: z.enum(['rows', 'row']), item: bodyNodeSchema }),
    z.object({
      t: z.literal('value'),
      type: z.enum(BODY_VALUE_TYPES).default('auto'),
      binding: bodyBindingSchema.default({ kind: 'none' }),
      /** An empty value quarantines the row instead of being sent. */
      required: z.boolean().default(false),
      /** What an empty value becomes: JSON null (an empty element / field), left out, or "". */
      empty: z.enum(['null', 'omit', 'empty']).default('null'),
    }),
  ])
)

export const apiDestinationFields = {
  dataSourceId: z.string().min(1, 'Choose a destination data source'),
  method: z.enum(API_METHODS).default('POST'),
  /** Under the data source's base URL; {{column}} takes the row's value (one request per row only). */
  path: z.string().trim().max(500).regex(/^\//, 'The request path starts with /').default('/'),
  body: z
    .object({
      format: z.enum(BODY_FORMATS).default('json'),
      /** The example the user pasted, kept so the mapping can be rebuilt. */
      sample: z.string().max(50_000).default(''),
      template: bodyNodeSchema.default({ t: 'object', fields: [] }),
    })
    .default({}),
  /** Batch mode: rows per request. */
  batchSize: z.number().int().min(1).max(1000).default(100),
  maxRequestsPerSecond: z.number().min(0.1).max(50).default(10),
  concurrency: z.number().int().min(1).max(4).default(1),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
  /** Send a stable Idempotency-Key (run:chunk:batch) so the API can ignore a request it already applied. */
  idempotencyKey: z.boolean().default(false),
  idempotencyHeader: z.string().trim().max(100).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes').default('Idempotency-Key'),
  /** Batch responses that list refused items: those rows go to the quarantine with the API's reason. */
  response: z
    .object({
      rejectedPath: z.string().trim().max(200).default(''),
      indexField: z.string().trim().max(100).default('index'),
      /** 1 when the API counts items from 1. */
      indexBase: z.union([z.literal(0), z.literal(1)]).default(0),
      messageField: z.string().trim().max(100).default('message'),
    })
    .default({}),
}
export const apiDestinationSpec = z.object(apiDestinationFields)
export type ApiDestinationSpec = z.infer<typeof apiDestinationSpec>

const apiDestination = z.object({
  id: z.string(),
  type: z.literal('destination'),
  position,
  kind: z.literal('api'),
  ...apiDestinationFields,
  // The API decides what a request does (create, update …); these keep the generic destination checks simple.
  mode: z.literal('append').default('append'),
  keys: z.array(z.string()).max(0).default([]),
  softDeleteMissing: z.literal(false).default(false),
})

// ── API calls inside a lane (lanes phase C): Enrich (read) and "Changes data" (write and continue) ──

/** A value taken from an API's answer into a new column (the body mapping in reverse). */
export const answerFieldSchema = z.object({
  /** Dotted path in the answer item, e.g. "data.salary" or "contacts.0.email". */
  path: z.string().trim().min(1, 'Choose a value from the answer').max(300),
  as: outputName,
  type: z.enum(COLUMN_TYPES).default('text'),
})
export type AnswerField = z.infer<typeof answerFieldSchema>

export const answerMappingSchema = z.object({
  /** Path to a list in the answer (empty = the answer itself is the item). */
  listPath: z.string().trim().max(300).default(''),
  /** A list in the answer: one row per item (decided), the first item, or every field as a JSON list. */
  listMode: z.enum(['rows', 'first', 'json']).default('rows'),
  fields: z.array(answerFieldSchema).max(100).default([]),
  /** The pasted or test-call answer the paths were picked from (kept so the mapping can be rebuilt). */
  sample: z.string().max(50_000).default(''),
})
export type AnswerMapping = z.infer<typeof answerMappingSchema>

export const ENRICH_METHODS = ['GET', 'POST'] as const
export const ENRICH_MODES = ['row', 'query', 'body'] as const
export const DEFAULT_MAX_CALLS = 50_000
export const CACHE_MAX_HOURS = 24 * 7

/**
 * Enrich (read-only, decided): one request per row (`/employees/{{code}}/details`)
 * or per batch: the batch's keys in a query parameter (comma-joined) or as a
 * list in a POST body; answer items are matched back by a key field.
 */
export const enrichStepSchema = z.object({
  id: z.string(),
  type: z.literal('enrich'),
  position,
  dataSourceId: z.string().min(1, 'Choose a REST data source'),
  method: z.enum(ENRICH_METHODS).default('GET'),
  /** Under the data source's base URL; {{column}} takes the row's value (per row only). */
  path: z.string().trim().max(500).regex(/^\//, 'The request path starts with /').default('/'),
  mode: z.enum(ENRICH_MODES).default('row'),
  /** POST used as a query: the body (per row, or with a list of rows in batch "body" mode). */
  body: z.object({ format: z.enum(BODY_FORMATS).default('json'), sample: z.string().max(50_000).default(''), template: bodyNodeSchema.default({ t: 'object', fields: [] }) }).default({}),
  /** Batch: the column whose values are sent, the query parameter that carries them, and the answer field that names each item's key. */
  keyColumn: z.string().default(''),
  queryParam: z.string().trim().max(100).default('ids'),
  matchField: z.string().trim().max(300).default(''),
  normalize: z.object({ trim: z.boolean().default(true), ignoreCase: z.boolean().default(true), leadingZeros: z.boolean().default(false) }).default({}),
  batchSize: z.number().int().min(1).max(500).default(50),
  answer: answerMappingSchema.default({}),
  /** 404 or no item for the key. */
  onNoMatch: z.enum(JOIN_NO_MATCH).default('keep'),
  /** Cross-run cache of mapped answers (decided: default 24 h, max 7 days; "not found" 1 h); 0 = off. */
  cacheHours: z.number().int().min(0).max(CACHE_MAX_HOURS).default(24),
  maxRequestsPerSecond: z.number().min(0.1).max(50).default(10),
  concurrency: z.number().int().min(1).max(4).default(2),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
})

export const CHANGE_METHODS = ['POST', 'PUT', 'PATCH'] as const
const apiRequestSchema = z.object({
  method: z.enum(CHANGE_METHODS).default('POST'),
  /** {{column}} takes the row's value, or (update request) a column the create answer was mapped to, e.g. {{user_id}}. */
  path: z.string().trim().max(500).regex(/^\//, 'The request path starts with /').default('/'),
  body: z.object({ format: z.enum(BODY_FORMATS).default('json'), sample: z.string().max(50_000).default(''), template: bodyNodeSchema.default({ t: 'object', fields: [] }) }).default({}),
})
export type ApiRequestSpec = z.infer<typeof apiRequestSchema>

/**
 * "API call (changes data)" (decided): create the record (e.g. POST /users),
 * take values from the answer (user_id) and continue. A call ledger per key
 * makes retries, resumed chunks and replays safe; an optional update request
 * runs when a known key's data changed. No DELETE.
 */
export const apiCallStepSchema = z.object({
  id: z.string(),
  type: z.literal('apicall'),
  position,
  dataSourceId: z.string().min(1, 'Choose a REST data source'),
  /** Columns that identify the record (the ledger key). */
  keys: z.array(z.string().min(1)).min(1, 'Choose the key columns').max(5),
  create: apiRequestSchema.default({}),
  update: apiRequestSchema.optional(),
  answer: answerMappingSchema.default({}),
  idempotencyHeader: z.string().trim().max(100).regex(/^[A-Za-z0-9-]+$/, 'Letters, numbers and dashes').default('Idempotency-Key'),
  maxRequestsPerSecond: z.number().min(0.1).max(50).default(5),
  concurrency: z.number().int().min(1).max(4).default(1),
  timeoutSeconds: z.number().int().min(1).max(120).default(30),
})

const destinationNode = z.discriminatedUnion('kind', [datasetDestination, datasourceDestination, apiDestination])

/** Every node of a body tree with its display path (`employee.name`, `contacts[].email`, `[].id`). */
export function walkBody(node: BodyNode, visit: (n: BodyNode, path: string, inRows: boolean, depth: number) => void, path = '', inRows = false, depth = 0) {
  visit(node, path, inRows, depth)
  if (node.t === 'object') for (const f of node.fields) walkBody(f.node, visit, path ? `${path}.${f.key}` : f.key, inRows, depth + 1)
  else if (node.t === 'array') walkBody(node.item, visit, `${path}[]`, inRows || node.items === 'rows', depth + 1)
}

export const PATH_PLACEHOLDER = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.:-]*$/

const exprUsesFields = (e: Expr): boolean => (e.kind === 'field' ? true : e.kind === 'op' ? exprUsesFields(e.left) || exprUsesFields(e.right) : e.kind === 'fn' ? e.args.some(exprUsesFields) : false)

/** True when the body sends several rows per request. */
export function isBatchBody(template: BodyNode) {
  let batch = false
  walkBody(template, (n) => {
    if (n.t === 'array' && n.items === 'rows') batch = true
  })
  return batch
}

/** Problems with an API destination that the schema alone can't express. English; shown as validation messages. */
export function apiDestinationIssues(spec: Pick<ApiDestinationSpec, 'body' | 'path'>): string[] {
  const issues: string[] = []
  const { format, template } = spec.body
  const batch = isBatchBody(template)
  let rowsArrays = 0
  let leaves = 0
  let tooDeep = false
  walkBody(template, (n, path, inRows, depth) => {
    if (depth > 12) tooDeep = true
    if (n.t === 'array') {
      if (n.items === 'rows') {
        rowsArrays++
        if (inRows) issues.push(`${path}: a list of rows can't be inside another list of rows.`)
      }
      if (format === 'form') issues.push(`${path || 'body'}: form-encoded bodies can't hold lists.`)
    }
    if (n.t === 'object') {
      const keys = new Set<string>()
      for (const f of n.fields) {
        if (keys.has(f.key)) issues.push(`${path || 'body'}: the key "${f.key}" appears twice.`)
        keys.add(f.key)
        if (format === 'xml') {
          const name = f.key.startsWith('@') ? f.key.slice(1) : f.key
          if (f.key !== '#text' && !XML_NAME.test(name)) issues.push(`"${f.key}" isn't a valid XML name.`)
          if ((f.key.startsWith('@') || f.key === '#text') && f.node.t !== 'value') issues.push(`${path}.${f.key}: attributes and text hold a single value.`)
        }
        if (format === 'form' && f.node.t !== 'value') issues.push(`${path ? `${path}.` : ''}${f.key}: form-encoded bodies are flat (no nested objects).`)
      }
    }
    if (n.t === 'value') {
      leaves++
      if (batch && !inRows && (n.binding.kind === 'column' || (n.binding.kind === 'expr' && exprUsesFields(n.binding.expr)))) {
        issues.push(`${path || 'body'}: outside the list of rows, use a fixed value or run information, not a column.`)
      }
    }
  })
  if (tooDeep) issues.push('The body is nested too deeply (12 levels at most).')
  if (leaves > 500) issues.push('The body has more than 500 values.')
  if (rowsArrays > 1) issues.push('Only one list in the body can hold the rows.')
  if (format === 'xml') {
    if (template.t !== 'object' || template.fields.length !== 1 || template.fields[0].key.startsWith('@') || template.fields[0].key === '#text') {
      issues.push('An XML body has exactly one root element.')
    } else if (template.fields[0].node.t === 'array') issues.push("The XML root element can't repeat; put the repeating element inside it.")
  }
  if (format === 'form' && template.t !== 'object') issues.push('A form-encoded body is a list of fields.')
  if (batch && new RegExp(PATH_PLACEHOLDER.source).test(spec.path)) {
    issues.push('The path can only use {{column}} values when each request sends one row.')
  }
  return issues
}

export const nodeSchema = z.union([sourceNode, filterNode, mapNode, splitNode, validateNode, rulesNode, routerNode, joinNode, unionNode, aggregateNode, dedupeNode, enrichStepSchema, apiCallStepSchema, destinationNode])
export type PipelineNode = z.infer<typeof nodeSchema>
/** @deprecated name kept for v1 call sites; a node is a step. */
export type PipelineStep = PipelineNode
export type SourceStep = z.infer<typeof sourceNode>
export type FilterStep = z.infer<typeof filterNode>
export type MapStep = z.infer<typeof mapNode>
export type SplitStep = z.infer<typeof splitNode>
export type ValidateStep = z.infer<typeof validateNode>
export type RulesStep = z.infer<typeof rulesNode>
export type RouterStep = z.infer<typeof routerNode>
export type JoinStep = z.infer<typeof joinNode>
export type UnionStep = z.infer<typeof unionNode>
export type AggregateStep = z.infer<typeof aggregateNode>
export type DedupeStep = z.infer<typeof dedupeNode>
export type EnrichStep = z.infer<typeof enrichStepSchema>
export type ApiCallStep = z.infer<typeof apiCallStepSchema>
export type DestinationStep = z.infer<typeof destinationNode>
export type NodeType = PipelineNode['type']

export const PORTS = ['', 'left', 'right'] as const
export type Port = (typeof PORTS)[number]

export const edgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  /** Router edges: the branch id, or "otherwise". */
  branch: z.string().default(''),
  /** Edges into a Join: the driving side (left) or the staged side (right). */
  port: z.enum(PORTS).optional(),
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
    for (const n of def.nodes) if (n.type === 'map') for (const message of outputPathIssues(n.fields.map((f) => f.to))) issue(`${stepTitle(n)}: ${message}`)
    const sources = def.nodes.filter((n): n is SourceStep => n.type === 'source')
    const destinations = def.nodes.filter((n) => n.type === 'destination')
    if (!sources.length) issue('A pipeline needs a Source.')
    if (sources.length > MAX_SOURCES) issue(`A pipeline reads at most ${MAX_SOURCES} sources.`)
    if (!destinations.length) issue('Add at least one Destination.')
    const byId = new Map(def.nodes.map((n) => [n.id, n]))
    let edgesOk = true
    let plan: LanePlan | null = null
    for (const e of def.edges) {
      const from = byId.get(e.from)
      const to = byId.get(e.to)
      if (!from || !to) {
        issue('A connection points to a step that no longer exists.')
        edgesOk = false
        continue
      }
      if (to.type === 'source') issue('Nothing can flow into a Source.')
      if (from.type === 'destination') issue('A Destination is the end of a path; it has no outgoing connections.')
      if (from.type === 'router') {
        if (e.branch !== OTHERWISE && !from.branches.some((b) => b.id === e.branch)) issue(`A connection from router ${from.id} has no branch.`)
      } else if (e.branch) issue('Only Router connections carry a branch.')
      if (to.type === 'join' && !e.port) issue(`${stepTitle(to)}: connect each input to the left (driving) or right (looked-up) side.`)
      if (to.type !== 'join' && e.port) issue('Only connections into a Join have a left or right side.')
    }
    // Every step is reachable from a Source, and the graph has no cycles.
    if (sources.length && edgesOk) {
      const out = new Map<string, string[]>()
      for (const e of def.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to])
      const reach = new Set<string>(sources.map((s) => s.id))
      const stack = [...reach]
      while (stack.length) for (const next of out.get(stack.pop()!) ?? []) if (!reach.has(next)) (reach.add(next), stack.push(next))
      const orphan = def.nodes.find((n) => !reach.has(n.id))
      if (orphan) issue(`"${stepTitle(orphan)}" isn't connected to a Source.`)
      if (!topoOrder(def.nodes, def.edges)) issue('Connections form a loop. Pipelines must flow one way.')
      else {
        plan = planLanes(def)
        for (const message of plan.issues) issue(message)
      }
    }
    for (const s of sources) {
      if (s.mode === 'incremental' && !s.watermarkColumn.trim()) issue('Incremental sync needs a watermark column (e.g. updated_at).')
    }
    for (const n of def.nodes) {
      if (n.type === 'union' && def.edges.filter((e) => e.to === n.id).length < 2) issue(`${stepTitle(n)}: connect at least two inputs.`)
      if (n.type === 'aggregate') {
        const names = new Set<string>([...n.groupBy, ...(n.timeGrain ? [timeGrainColumn(n.timeGrain)] : [])])
        for (const m of n.measures) {
          if (names.has(m.name)) issue(`${stepTitle(n)}: the output column "${m.name}" appears twice.`)
          names.add(m.name)
          if (m.fn !== 'count' && !m.column.trim()) issue(`${stepTitle(n)}: "${m.name}" needs a column.`)
        }
        // An aggregate over an incremental read would count only the changed rows.
        for (const s of sources) {
          if (s.mode === 'incremental' && plan?.lanes.get(n.id)?.has(s.id)) issue(`${stepTitle(n)} needs a full read: set "${stepTitle(s)}" to Full.`)
        }
      }
      if (n.type === 'enrich') {
        for (const message of enrichIssues(n)) issue(`${stepTitle(n)}: ${message}`)
      }
      if (n.type === 'apicall') {
        for (const r of [n.create, ...(n.update ? [n.update] : [])]) {
          for (const message of apiDestinationIssues({ path: r.path, body: r.body })) issue(`${stepTitle(n)}: ${message}`)
          if (isBatchBody(r.body.template)) issue(`${stepTitle(n)}: each call sends one row; remove the list of rows from the body.`)
        }
        if (n.create.body.template.t === 'object' && !n.create.body.template.fields.length && n.create.method !== 'PUT') issue(`${stepTitle(n)}: paste an example request body.`)
      }
      if (n.type === 'dedupe' && n.keep === 'most_recent' && !n.recentBy.trim()) issue(`${stepTitle(n)}: choose the date or timestamp column that decides the most recent row.`)
    }
    // Soft deletes need every streamed row (driver and Union partners); staged lanes only add values.
    const streamedIncremental = sources.some((s) => s.mode === 'incremental' && (!plan || plan.streamed.includes(s.id)))
    for (const d of destinations) {
      if (d.type !== 'destination') continue
      if (d.kind === 'api') {
        for (const message of apiDestinationIssues(d)) issue(`${stepTitle(d)}: ${message}`)
        if (d.body.template.t === 'object' && !d.body.template.fields.length) issue(`${stepTitle(d)}: paste an example request body.`)
        continue
      }
      if (d.mode === 'upsert' && d.keys.length === 0) issue(`${stepTitle(d)}: upsert needs at least one key column.`)
      if (d.softDeleteMissing) {
        if (d.mode !== 'upsert') issue(`${stepTitle(d)}: "mark missing rows deleted" needs upsert mode.`)
        if (streamedIncremental) issue(`${stepTitle(d)}: "mark missing rows deleted" needs a full read, not incremental.`)
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
    case 'split':
      return `Split list ${n.path || 'list'}`
    case 'validate':
      return `Validate (${n.rules.length} rule${n.rules.length === 1 ? '' : 's'})`
    case 'rules':
      return `Business rules (${n.ruleIds.length})`
    case 'router':
      return `Route (${n.branches.length + 1} branches)`
    case 'join':
      return `Join on ${n.keys.map((k) => k.left).filter(Boolean).join(', ') || 'keys'}`
    case 'union':
      return 'Union'
    case 'aggregate':
      return `Aggregate by ${[...n.groupBy, ...(n.timeGrain ? [`${n.timeGrain.column} (${n.timeGrain.grain})`] : [])].join(', ') || 'all rows'}`
    case 'dedupe':
      return `Deduplicate on ${n.keys.join(', ')}`
    case 'enrich':
      return `Enrich from ${n.method} ${n.path}`
    case 'apicall':
      return `Call ${n.create.method} ${n.create.path}`
    case 'destination':
      return n.kind === 'dataset' ? `Write dataset ${n.datasetName}` : n.kind === 'api' ? `Send ${n.method} ${n.path}` : `Write ${n.table}`
  }
}

/** Problems with an Enrich step the schema alone can't express. English; shown as validation messages. */
export function enrichIssues(n: EnrichStep): string[] {
  const issues: string[] = []
  if (!n.answer.fields.length) issues.push('choose at least one value from the answer.')
  if (n.mode !== 'row') {
    if (!n.keyColumn.trim()) issues.push('choose the column whose values are sent.')
    if (!n.matchField.trim()) issues.push("choose the answer field that names each item's key.")
    if (!n.answer.listPath.trim()) issues.push('choose the list in the answer that holds the items.')
    if (new RegExp(PATH_PLACEHOLDER.source).test(n.path)) issues.push('the path can only use {{column}} values when each request sends one row.')
  }
  if (n.mode === 'body') {
    if (n.method !== 'POST') issues.push('sending keys in the body needs POST.')
    if (!isBatchBody(n.body.template)) issues.push('mark the list in the body that holds the keys.')
  }
  if (n.mode !== 'body' && n.method === 'POST') {
    for (const message of apiDestinationIssues({ path: n.path, body: n.body })) issues.push(message)
    if (isBatchBody(n.body.template)) issues.push('a list of rows in the body needs the "keys in the body" mode.')
  }
  return issues
}

/** Name of an Aggregate's time bucket column: its own name, else "<column>_<grain>". */
export function timeGrainColumn(t: NonNullable<AggregateStep['timeGrain']>) {
  return t.as || `${t.column}_${t.grain}`.slice(0, 63)
}

/** Steps that need every row before they answer (run in the finish phase). */
export function isBlockingStep(n: PipelineNode): boolean {
  return n.type === 'aggregate' || (n.type === 'dedupe' && n.keep !== 'first')
}

/** What a data source destination writes to: its table, or "POST /employees" for an API. */
export function destinationTarget(n: DestinationStep): string {
  return n.kind === 'dataset' ? n.datasetName : n.kind === 'api' ? `${n.method} ${n.path}` : n.table
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

export const SCHEDULE_TYPES = ['manual', 'hourly', 'daily', 'weekly', 'monthly', 'cron', 'after'] as const
/** "after": run when another pipeline finishes (SC-5) with one of these outcomes. */
export const AFTER_OUTCOMES = ['success', 'success_or_partial', 'any'] as const
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
  afterPipelineId: z.string().max(100).default(''),
  afterOn: z.enum(AFTER_OUTCOMES).default('success'),
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

export interface LookupRef {
  key: string
  dataset: string
  keyColumn: string
  valueColumn: string
  /** relate: how references are compared (the loaded table's keys are normalized the same way). */
  match?: 'loose' | 'loose_zeros' | 'exact'
}

/**
 * Lookup tables a definition reads (loaded before a run): lookup (MP-6) "dataset|key|value";
 * relate (MP-8) "dataset|key|value|match", keyed by the normalized reference.
 */
export function lookupRefs(def: PipelineDefinition): LookupRef[] {
  const refs = new Map<string, LookupRef>()
  for (const n of def.nodes) {
    if (n.type !== 'map') continue
    for (const f of n.fields) for (const t of f.transforms) {
      if (t.fn !== 'lookup' && t.fn !== 'relate') continue
      const [dataset = '', keyColumn = '', valueColumn = '', , rawMatch = ''] = t.args.map((x) => x.trim())
      const match = t.fn === 'relate' ? (rawMatch === 'loose_zeros' || rawMatch === 'exact' ? rawMatch : 'loose') : undefined
      const key = `${dataset}|${keyColumn}|${valueColumn}${match ? `|${match}` : ''}`
      refs.set(key, { key, dataset, keyColumn, valueColumn, ...(match ? { match } : {}) })
    }
  }
  return [...refs.values()]
}
