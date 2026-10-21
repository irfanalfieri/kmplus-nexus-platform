import { z } from 'zod'
import { API_METHODS, BODY_META, DEFAULT_SETTINGS, FILTER_OPERATORS, PATH_PLACEHOLDER, SEVERITIES, TRANSFORMS, definitionSchema, isBatchBody, newStepId, scheduleSchema, type BodyBinding, type BodyNode, type PipelineDefinition, type PipelineEdge, type PipelineNode, type PipelineSchedule } from '@/lib/pipelines/definition'
import { PIPELINE_TEMPLATES, buildPipelineTemplate, columnTypeFromSql, type PipelineTemplateId } from '@/lib/pipelines/templates'
import { BodySampleError, autoBindBody, bodyArrays, bodyLeaves, matchColumn, parseBodySample, setRowsArray } from '@/lib/pipelines/body-template'
import { mapOutputColumns } from '@/lib/pipelines/nested'
import { parseCheck } from '@/lib/pipelines/check-messages'
import { WRITE_CAPABLE } from '@/lib/connectors/capabilities'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import { AnswerError } from './prompts'
import type { ChatMessage } from './llm'

/**
 * AI-2 (pipeline drafts from a description) and AI-3 (run error diagnosis).
 * Pure; covered by scripts/engine-tests.ts. The model never writes a graph:
 * it fills a small plan that Nexus checks against the real sources, tables and
 * columns and turns into a pipeline with the tested templates. A draft writes
 * to a dataset, a database table, a REST API or a KMPlus product; an API body
 * comes from a small example the model writes, read like a pasted example in
 * the editor. A diagnosis may propose one of a few fixes Nexus knows how to
 * apply; the person reviews and the fix is saved as a draft, never published.
 */

type Col = { name: string; type: string; key?: boolean }
export interface PlanSource {
  id: string
  name: string
  sourceType: string
  role: 'source' | 'destination'
  tables: { name: string; columns: Col[] }[]
  /** REST APIs: the base URL's host only (never the rest of the URL, credentials or headers). */
  host?: string
}

// ── AI-2: pipeline drafts ────────────────────────────────────────────────────

const SCHEDULE_KINDS = ['manual', 'hourly', 'daily', 'weekly', 'monthly'] as const
type PlanTemplate = PipelineTemplateId | 'copy'
/** Templates a draft can start from: the pipeline templates, and "copy" (rows written as they are). */
export const PLAN_TEMPLATES = ['copy', ...PIPELINE_TEMPLATES.map((t) => t.id)] as [PlanTemplate, ...PlanTemplate[]]
const PLAN_DESTINATIONS = ['dataset', 'database', 'api', 'kmplus'] as const
type PlanDestinationKind = (typeof PLAN_DESTINATIONS)[number]

const columnList = (cols: Col[]) => cols.map((c) => (c.key ? `${c.name} (key)` : c.name)).join(', ')
/** Data sources a draft may write to: added as destinations, with a writer. */
const writableDestinations = (sources: PlanSource[]) => sources.filter((s) => s.role === 'destination' && WRITE_CAPABLE.includes(s.sourceType as (typeof WRITE_CAPABLE)[number]))

function describeDestination(s: PlanSource): string {
  if (s.sourceType === 'rest') {
    const fields = s.tables[0]?.columns.slice(0, 40) ?? []
    return `- id "${s.id}": ${s.name} (REST API${s.host ? ` at ${s.host}` : ''})${fields.length ? `; fields seen in its scan: ${fields.map((c) => c.name).join(', ')}` : ''}`
  }
  const what = s.sourceType === 'kmplus' ? 'KMPlus product' : `${s.sourceType} database`
  const tables = s.tables.length ? s.tables.map((t) => `${t.name} [${columnList(t.columns)}]`).join('; ') : '(not scanned)'
  return `- id "${s.id}": ${s.name} (${what}); ${s.sourceType === 'kmplus' ? 'entities' : 'tables'}: ${tables}`
}

export function pipelinePrompt(input: { text: string; sources: PlanSource[]; datasets: { name: string; columns: Col[] }[] }): ChatMessage[] {
  const sources = input.sources
    .filter((s) => s.role === 'source')
    .map((s) => `- id "${s.id}": ${s.name} (${s.sourceType}); tables: ${s.tables.length ? s.tables.map((t) => `${t.name} [${t.columns.map((c) => c.name).join(', ')}]`).join('; ') : '(not scanned)'}`)
    .join('\n')
  const destinations = writableDestinations(input.sources).map(describeDestination).join('\n')
  return [
    {
      role: 'system',
      content: `You plan a KMPlus Nexus data pipeline from a description. Answer with one JSON object only:
{"name":"<short name>","description":"<one sentence>","template":"${PLAN_TEMPLATES.join('|')}","dataSourceId":"<source id>","table":"<source table>","destination":<one destination below>,"filter":{"match":"all|any","conditions":[{"field":"<source column>","operator":"<operator>","value":"<text>"}]} or null,"schedule":{"type":"${SCHEDULE_KINDS.join('|')}","time":"HH:mm","weekdays":[1,2,3,4,5],"dayOfMonth":1,"minute":0},"explanation":"<one or two sentences>"}
Templates: copy = write the table's rows to the destination as they are (any data, e.g. one API into another API or a database table) | ${PIPELINE_TEMPLATES.map((t) => `${t.id} = ${t.description}`).join(' | ')}
Destinations (where the rows are written):
- {"kind":"dataset","datasetName":"<lowercase_snake_case>"}: a Nexus dataset, new or existing.
- {"kind":"database","dataSourceId":"<destination id>","table":"<its table>","columns":[{"from":"<source column>","to":"<its column>"}],"mode":"append|upsert","keys":["<its key column>"]}: an existing table. Columns with the same or a synonym name are matched automatically; list only the others. Upsert updates rows with the same keys.
- {"kind":"api","dataSourceId":"<REST destination id>","method":"${API_METHODS.join('|')}","path":"/<path under its base URL>","body":<small example request body as JSON>,"rowsList":"<key of the body's list that carries the rows, or empty>"}: in the body and the path, "{{<source column>}}" alone is a row's value; other values are sent as fixed values (never put credentials in a body: sign-in comes from the data source); ${BODY_META.map((m) => `"{{${m}}}"`).join(', ')} are run information. A body that is a list ([{…}]), or whose rowsList names a list in it, sends many rows per request; otherwise each row is its own request.
- {"kind":"kmplus","dataSourceId":"<product id>","table":"<entity>"}: a KMPlus product. With hris-employee the employees also stay in the employees dataset.
Column names in the destination are source column names; with hris-employee and ad-users Nexus maps the columns first and follows the renames.
Data sources to read (use only these ids, tables and columns):
${sources || '(none)'}
Destinations to write to (use only these ids, tables and columns):
${destinations || '(none: only datasets)'}
Existing datasets: ${input.datasets.map((d) => d.name).join(', ') || 'none'}.
A pipeline writes to a dataset or to any destination listed above. When the description names a destination that is not listed, use a dataset and say in the explanation that it must be added first (Data Sources → Add Destination).
Filter conditions use SOURCE column names and keep only the rows the description asks for (e.g. active employees). Operators: ${FILTER_OPERATORS.join(', ')}; values are strings; in_list takes "a, b".
Schedule times are Asia/Jakarta (WIB); weekdays 0 = Sunday … 6 = Saturday. Use "manual" when no timing is mentioned.`,
    },
    { role: 'user', content: input.text },
  ]
}

/** Small models write "rest" or "table" for a kind; null for unused fields. */
const KIND_ALIASES: Record<string, PlanDestinationKind> = { rest: 'api', rest_api: 'api', table: 'database', db: 'database', datasource: 'database', kmplus_product: 'kmplus', product: 'kmplus' }
const destinationPlan = z.object({
  kind: z.preprocess((v) => (typeof v === 'string' ? (KIND_ALIASES[v.trim().toLowerCase()] ?? v.trim().toLowerCase()) : v), z.enum(PLAN_DESTINATIONS)),
  datasetName: z.string().max(48).nullish(),
  dataSourceId: z.string().nullish(),
  table: z.string().nullish(),
  columns: z.array(z.object({ from: z.string().min(1), to: z.string().min(1) })).max(300).nullish(),
  mode: z.enum(['append', 'upsert']).nullish(),
  keys: z.array(z.string().min(1)).max(5).nullish(),
  method: z.string().max(20).nullish(),
  path: z.string().max(500).nullish(),
  /** An example request body: JSON (or JSON text). */
  body: z.unknown().optional(),
  rowsList: z.string().max(200).nullish(),
})
type DestinationPlan = z.infer<typeof destinationPlan>

const planSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(500).optional(),
  template: z.enum(PLAN_TEMPLATES).default('copy'),
  dataSourceId: z.string().min(1),
  table: z.string().min(1),
  destination: destinationPlan.nullish(),
  /** Older answers: the dataset and the KMPlus product (hris-employee) at the top level. */
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

type Target =
  | { kind: 'dataset'; datasetName?: string; kmplusDestinationId?: string }
  /** A database table or a KMPlus product's entity. */
  | { kind: 'table'; dest: PlanSource; plan: DestinationPlan }
  | { kind: 'api'; dest: PlanSource; plan: DestinationPlan }

/** Where the draft writes: the plan's destination checked against the data sources added as destinations. */
function planTarget(plan: PipelinePlan, sources: PlanSource[]): Target {
  const d = plan.destination
  // Older answers: a dataset, and (hris-employee only) a KMPlus product beside it.
  let kmplus = plan.kmplusDestinationId || undefined
  if (kmplus) {
    const dest = sources.find((s) => s.id === kmplus && s.role === 'destination' && s.sourceType === 'kmplus')
    if (!dest) throw new AnswerError(`"${kmplus}" is not a KMPlus product destination. Leave kmplusDestinationId empty or use a listed product id.`)
    if (plan.template !== 'hris-employee') kmplus = undefined
  }
  if (!d || d.kind === 'dataset') return { kind: 'dataset', datasetName: d?.datasetName || plan.datasetName || undefined, kmplusDestinationId: kmplus }

  const writable = writableDestinations(sources)
  const candidates = writable.filter((s) => (d.kind === 'api' ? s.sourceType === 'rest' : d.kind === 'kmplus' ? s.sourceType === 'kmplus' : s.sourceType !== 'rest' && s.sourceType !== 'kmplus'))
  const dest = writable.find((s) => s.id === d.dataSourceId) ?? (!d.dataSourceId && candidates.length === 1 ? candidates[0] : undefined)
  if (!dest) {
    const id = d.dataSourceId ?? ''
    const ids = candidates.map((s) => s.id).join(', ')
    if (!candidates.length) throw new AnswerError(`There is no "${d.kind}" destination to write to. Use kind "dataset" and say in the explanation which destination to add first (Data Sources → Add Destination).`)
    if (d.kind === 'api') throw new AnswerError(`"${id}" is not a REST API added as a destination. Use one of: ${ids}.`)
    if (d.kind === 'kmplus') throw new AnswerError(`"${id}" is not a KMPlus product added as a destination. Use one of: ${ids}.`)
    throw new AnswerError(`"${id}" is not a database added as a destination. Use one of: ${ids}.`)
  }
  if (dest.sourceType === 'rest') {
    if (d.kind !== 'api') throw new AnswerError(`${dest.name} is a REST API: use kind "api" with a method, a path and a body.`)
    return { kind: 'api', dest, plan: d }
  }
  if (d.kind === 'api') throw new AnswerError(`${dest.name} is not a REST API: use kind "${dest.sourceType === 'kmplus' ? 'kmplus' : 'database'}" with a table.`)
  // Employees to a KMPlus product stay in the employees dataset too, as the template does.
  if (dest.sourceType === 'kmplus' && plan.template === 'hris-employee') return { kind: 'dataset', datasetName: d.datasetName || plan.datasetName || undefined, kmplusDestinationId: dest.id }
  return { kind: 'table', dest, plan: d }
}

/** Columns reaching the end of a chain, and what a source column is called there (a template's Map renames). */
interface Arriving {
  names: string[]
  resolve: (name: string) => string | null
}

function arrivingAt(nodes: PipelineNode[], sourceColumns: Col[]): Arriving {
  const map = [...nodes].reverse().find((n) => n.type === 'map')
  if (!map || map.type !== 'map') {
    const names = sourceColumns.map((c) => c.name)
    return { names, resolve: (name) => (names.includes(name) ? name : null) }
  }
  const names = mapOutputColumns(map.fields).map((c) => c.name)
  return { names, resolve: (name) => (names.includes(name) ? name : (map.fields.find((f) => f.from === name && names.includes(f.to))?.to ?? null)) }
}

/** A Map onto the table's columns (the model's pairs, the rest by name or HR synonym) and the table destination. */
function tableSteps(target: Extract<Target, { kind: 'table' }>, arriving: Arriving, at: (i: number) => { x: number; y: number }, notes: string[]): PipelineNode[] {
  const { dest, plan: d } = target
  if (!dest.tables.length) throw new AnswerError(`${dest.name} has no scanned tables yet. Use kind "dataset" and say in the explanation to scan ${dest.name} first.`)
  const table = dest.tables.find((t) => t.name === d.table) ?? (!d.table && dest.tables.length === 1 ? dest.tables[0] : undefined)
  if (!table) throw new AnswerError(`Table "${d.table ?? ''}" is not in ${dest.name}. Use one of: ${dest.tables.map((t) => t.name).join(', ')}.`)
  const tableColumns = table.columns.map((c) => c.name)
  const pairs: { from: string; to: string }[] = []
  const notInTable: string[] = []
  const notArriving: string[] = []
  for (const p of d.columns ?? []) {
    const from = arriving.resolve(p.from)
    if (!tableColumns.includes(p.to)) notInTable.push(p.to)
    else if (!from) notArriving.push(p.from)
    else if (!pairs.some((x) => x.to === p.to)) pairs.push({ from, to: p.to })
  }
  if (notInTable.length) throw new AnswerError(`Column(s) ${notInTable.join(', ')} are not in ${table.name}. Use only: ${tableColumns.join(', ')}.`)
  if (notArriving.length) throw new AnswerError(`Column(s) ${notArriving.join(', ')} don't reach the destination. Use only: ${arriving.names.join(', ')}.`)
  // The others as the editor's auto match does: same name, then HR synonyms.
  for (const c of table.columns) {
    if (pairs.some((p) => p.to === c.name)) continue
    const from = matchColumn(c.name, '', arriving.names.filter((n) => !pairs.some((p) => p.from === n)))
    if (from) pairs.push({ from, to: c.name })
  }
  if (!pairs.length) throw new AnswerError(`No column reaching the destination matches ${table.name}. Give "columns" pairs from: ${arriving.names.join(', ')} to: ${tableColumns.join(', ')}.`)
  pairs.sort((a, b) => tableColumns.indexOf(a.to) - tableColumns.indexOf(b.to))

  const written = pairs.map((p) => p.to)
  let keys = (d.keys ?? []).map((k) => (written.includes(k) ? k : (pairs.find((p) => p.from === arriving.resolve(k))?.to ?? k)))
  const badKeys = keys.filter((k) => !written.includes(k))
  if (badKeys.length) throw new AnswerError(`Key column(s) ${badKeys.join(', ')} are not columns written to ${table.name}. Use some of: ${written.join(', ')}.`)
  const tableKeys = table.columns.filter((c) => c.key && written.includes(c.name)).map((c) => c.name)
  const mode = d.mode ?? (keys.length || tableKeys.length ? 'upsert' : 'append')
  if (mode === 'upsert' && !keys.length) keys = tableKeys
  if (mode === 'upsert' && !keys.length) throw new AnswerError(`Upsert into ${table.name} needs "keys": the columns that identify a row. Use some of: ${written.join(', ')}, or mode "append".`)
  const left = tableColumns.filter((c) => !written.includes(c))
  if (left.length) notes.push(`Not written (no matching column): ${left.join(', ')}.`)
  notes.push(mode === 'upsert' ? `Updates rows of ${table.name} with the same ${keys.join(', ')}; adds the others.` : `Adds every row to ${table.name}.`)

  const types = new Map(table.columns.map((c) => [c.name, c.type]))
  return [
    { id: newStepId(), type: 'map', position: at(1), keepUnmapped: false, fields: pairs.map((p) => ({ from: p.from, to: p.to, type: columnTypeFromSql(types.get(p.to) ?? ''), transforms: [] })) },
    { id: newStepId(), type: 'destination', position: at(2), kind: 'datasource', dataSourceId: dest.id, table: table.name, mode, keys: mode === 'upsert' ? keys : [], softDeleteMissing: false, softDeleteColumn: '' },
  ]
}

const PLACEHOLDER_ONLY = /^\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/
type LeafPatch = { binding: BodyBinding; type?: 'auto' }

/** First example item of a list (objects merged, the first item's values win), matching how a pasted list is read. */
function exampleItem(v: unknown): unknown {
  if (!Array.isArray(v)) return undefined
  const objects = v.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[]
  return objects.length === v.length && objects.length ? Object.assign({}, ...[...objects].reverse()) : v.find((x) => x !== null && x !== undefined)
}

/**
 * The body of an API destination from the model's example, read like an example pasted in the
 * editor (parseBodySample, the rows list, auto binding). "{{column}}" (or a column's bare name)
 * binds that column, run information binds itself, any other value is sent as a fixed value.
 */
function bodyFromExample(example: unknown, rowsList: string, arriving: Arriving): { body: { format: 'json'; sample: string; template: BodyNode }; missing: string[]; fixed: string[]; unbound: string[] } {
  let value = example
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value)
    } catch {
      value = undefined
    }
  }
  if (value === null || typeof value !== 'object') throw new AnswerError('Give "body": a small example request body as JSON, an object (one request per row) or a list (many rows per request).')
  const sample = JSON.stringify(value, null, 2)
  let template: BodyNode
  try {
    template = parseBodySample('json', sample)
  } catch (err) {
    throw new AnswerError(`The example body can't be read (${err instanceof BodySampleError ? err.code : 'json'}). Give it as plain JSON.`)
  }
  const list = rowsList.trim().replace(/\[\]$/, '')
  if (list) {
    const lists = bodyArrays(template).filter((a) => !a.nested)
    const found = lists.find((a) => a.path === `${list}[]`)
    if (!found) throw new AnswerError(`"${list}" is not a list in the body. Use one of: ${lists.map((a) => a.path.replace(/\[\]$/, '')).filter(Boolean).join(', ') || '(none)'}, or leave rowsList empty.`)
    template = setRowsArray(template, found.addr)
  }
  if (!bodyLeaves(template).length) throw new AnswerError('Give "body": a small example request body as JSON, an object (one request per row) or a list (many rows per request).')

  const missing: string[] = []
  const fixed: string[] = []
  const bindLeaf = (v: unknown, path: string): LeafPatch | null => {
    if (v === null || v === undefined) return null
    if (typeof v === 'string') {
      const placeholder = PLACEHOLDER_ONLY.exec(v.trim())
      if (placeholder) {
        const column = arriving.resolve(placeholder[1])
        if (column) return { binding: { kind: 'column', column }, type: 'auto' }
        const meta = BODY_META.find((m) => m === placeholder[1])
        if (meta) return { binding: { kind: 'meta', name: meta } }
        missing.push(placeholder[1])
        return null
      }
      if (v.includes('{{')) throw new AnswerError(`Body value "${v.slice(0, 60)}" mixes text and a column: use "{{column}}" alone, or a fixed value.`)
      const column = arriving.resolve(v)
      if (column) return { binding: { kind: 'column', column }, type: 'auto' }
    }
    fixed.push(`${path || 'body'} = ${JSON.stringify(v).slice(0, 60)}`)
    return { binding: { kind: 'constant', value: String(v).slice(0, 2000) } }
  }
  const walk = (node: BodyNode, ex: unknown, path: string): BodyNode => {
    if (node.t === 'object') {
      const o = ex && typeof ex === 'object' && !Array.isArray(ex) ? (ex as Record<string, unknown>) : {}
      return { ...node, fields: node.fields.map((f) => ({ ...f, node: walk(f.node, o[f.key], path ? `${path}.${f.key}` : f.key) })) }
    }
    if (node.t === 'array') return { ...node, item: walk(node.item, exampleItem(ex), `${path}[]`) }
    const patch = bindLeaf(ex, path)
    return patch ? { ...node, ...patch } : node
  }
  // Values the example left empty are matched by their key, as in the editor.
  const bound = autoBindBody(walk(template, value, ''), arriving.names).template
  const unbound = bodyLeaves(bound).filter((l) => l.node.binding.kind === 'none').map((l) => l.path || 'body')
  return { body: { format: 'json', sample, template: bound }, missing, fixed, unbound }
}

/** The API destination step: method, a path under the base URL, and the body from the model's example. */
function apiStep(target: Extract<Target, { kind: 'api' }>, arriving: Arriving, position: { x: number; y: number }, notes: string[]): PipelineNode {
  const { dest, plan: d } = target
  const method = API_METHODS.find((m) => m === (d.method ?? 'POST').trim().toUpperCase())
  if (!method) throw new AnswerError(`Method "${d.method}" can't send rows. Use one of: ${API_METHODS.join(', ')}.`)
  let path = (d.path ?? '').trim() || '/'
  if (/^([a-z][a-z0-9+.-]*:)?\/\//i.test(path)) throw new AnswerError(`Give the path under the base URL of ${dest.name} (e.g. /employees), not a full URL.`)
  if (!path.startsWith('/')) path = `/${path}`
  // "." and ".." would move the request out of the path (the URL parser resolves them).
  if (path.split(/[?#]/)[0].split('/').some((seg) => /^(\.|%2e){1,2}$/i.test(seg))) throw new AnswerError(`The path can't contain "." or ".." segments.`)
  const missing: string[] = []
  path = path.replace(new RegExp(PATH_PLACEHOLDER.source, 'g'), (m, name: string) => {
    const column = arriving.resolve(name)
    if (column) return `{{${column}}}`
    missing.push(name)
    return m
  })
  const built = bodyFromExample(d.body, d.rowsList ?? '', arriving)
  missing.push(...built.missing)
  if (missing.length) throw new AnswerError(`Column(s) ${[...new Set(missing)].map((n) => `{{${n}}}`).join(', ')} don't reach the destination. Use only: ${arriving.names.join(', ')}.`)
  notes.push(`Sends ${method} ${path} to ${dest.name}, ${isBatchBody(built.body.template) ? 'many rows per request' : 'one request per row'}. Nothing was sent while drafting; try it with Preview request and Send test request.`)
  if (built.fixed.length) notes.push(`Fixed values in the body: ${built.fixed.join(', ')}.`)
  if (built.unbound.length) notes.push(`Body values with no column (sent empty): ${built.unbound.join(', ')}.`)
  return {
    id: newStepId(),
    type: 'destination',
    position,
    kind: 'api',
    dataSourceId: dest.id,
    method,
    path,
    body: built.body,
    batchSize: 100,
    maxRequestsPerSecond: 10,
    concurrency: 1,
    timeoutSeconds: 30,
    idempotencyKey: false,
    idempotencyHeader: 'Idempotency-Key',
    response: { rejectedPath: '', indexField: 'index', indexBase: 0, messageField: 'message' },
    mode: 'append',
    keys: [],
    softDeleteMissing: false,
  }
}

/** Steps for a database, KMPlus or API destination: the template's steps (without its dataset) or "copy", then the destination. */
function buildToDataSource(template: PlanTemplate, target: Exclude<Target, { kind: 'dataset' }>, opts: { source: PlanSource; table: { name: string; columns: Col[] }; datasets: { name: string; columns: Col[] }[] }) {
  const notes: string[] = []
  let nodes: PipelineNode[]
  let edges: PipelineEdge[]
  let tail: PipelineNode
  let description = `Copy ${opts.table.name} to ${target.dest.name}`
  // A CSV / Excel template only shapes a dataset; elsewhere it is a copy.
  if (template === 'copy' || template === 'csv-dataset') {
    tail = { id: newStepId(), type: 'source', position: { x: 40, y: 120 }, dataSourceId: opts.source.id, table: opts.table.name, maxRows: 1_000_000, mode: 'full', watermarkColumn: '' }
    nodes = [tail]
    edges = []
  } else {
    const built = buildPipelineTemplate(template, { dataSourceId: opts.source.id, sourceType: opts.source.sourceType, table: opts.table.name, columns: opts.table.columns, datasets: opts.datasets })
    const dataset = built.nodes.find((n) => n.type === 'destination')!
    const into = built.edges.find((e) => e.to === dataset.id)!
    nodes = built.nodes.filter((n) => n.id !== dataset.id)
    edges = built.edges.filter((e) => e.to !== dataset.id)
    tail = nodes.find((n) => n.id === into.from)!
    notes.push(...built.notes)
    description = `${opts.table.name} to ${target.dest.name} (template ${PIPELINE_TEMPLATES.find((t) => t.id === template)?.name ?? template})`
  }
  const arriving = arrivingAt(nodes, opts.table.columns)
  const at = (i: number) => ({ x: tail.position.x + 300 * i, y: tail.position.y })
  const steps = target.kind === 'api' ? [apiStep(target, arriving, at(1), notes)] : tableSteps(target, arriving, at, notes)
  const chain = [tail, ...steps]
  for (let i = 1; i < chain.length; i++) edges.push({ id: newStepId(), from: chain[i - 1].id, to: chain[i].id, branch: '' })
  return { description, nodes: [...nodes, ...steps], edges, notes }
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
  const target = planTarget(plan, input.sources)
  const schedule = scheduleSchema.safeParse({ ...(plan.schedule ?? { type: 'manual' }), timezone: 'Asia/Jakarta' })
  if (!schedule.success) throw new AnswerError('The schedule is invalid: time must be "HH:mm", weekdays 0–6, dayOfMonth 1–28.')

  let built: { description: string; nodes: PipelineNode[]; edges: PipelineEdge[]; notes: string[] }
  if (target.kind === 'dataset') {
    built = buildPipelineTemplate(plan.template === 'copy' ? 'csv-dataset' : plan.template, {
      dataSourceId: source.id,
      sourceType: source.sourceType,
      table: table.name,
      columns: table.columns,
      datasetName: target.datasetName,
      datasets: input.datasets,
      kmplusDestinationId: target.kmplusDestinationId,
    })
    const dataset = built.nodes.find((n) => n.type === 'destination' && n.kind === 'dataset')
    if (plan.template === 'copy' && dataset?.type === 'destination' && dataset.kind === 'dataset') built.description = `Copy ${table.name} to the ${dataset.datasetName} dataset`
  } else built = buildToDataSource(plan.template, target, { source, table, datasets: input.datasets })
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
