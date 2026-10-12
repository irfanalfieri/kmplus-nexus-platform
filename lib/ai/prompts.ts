import { z } from 'zod'
import { COLUMN_TYPES, FILTER_OPERATORS, TRANSFORMS, EXPR_FNS, EXPR_OPS, type MapStep } from '@/lib/pipelines/definition'
import { ruleBodySchema, type RuleBody } from '@/lib/rules/definition'
import { AGGREGATIONS, FILTER_OPS, GRAINS, NUMERIC_TYPES, SORTS, TIME_TYPES, WIDGET_TYPES, widgetSchema, type Widget } from '@/lib/analytics/definition'
import { suggestColumnPolicy } from '@/lib/governance/definition'
import type { ChatMessage } from './llm'

/**
 * Prompts and answer checks for the AI assistant (#14). Pure; covered by
 * scripts/engine-tests.ts. Every answer is validated against the same schemas
 * the editors use and against the real column lists, so a model can only
 * propose things a person could have built by hand, and the person reviews
 * them before anything is saved or run.
 */

export class AnswerError extends Error {}

type Col = { name: string; type: string }

// ── Mapping suggestions ──────────────────────────────────────────────────────

const TRANSFORM_GUIDE = `trim, uppercase, lowercase, titlecase: no args
replace [find, replacement]; regex_replace [pattern, replacement]; regex_extract [pattern, group]
default_if_empty [value]; coalesce [other column, …]; prefix [text]; suffix [text]
substring [start, length]; concat ["{first_name} {last_name}"]; split [separator, part index]
format_date [output pattern, input pattern] e.g. ["yyyy-MM-dd", "yyyyMMdd"] or ["yyyy-MM-dd", "dd/MM/yyyy"]
round [decimals]; number_format [decimals, locale]; to_number; to_boolean; hash [salt]
conditional [operator, value, then, else] e.g. ["equals", "1", "Male", "Female"]; else "{value}" keeps the value`

/** Samples a model may see: none for columns that look personal or sensitive (names, emails, NIK, salary…). */
export function safeSamples(column: string, values: unknown[], max = 3): string[] {
  if (suggestColumnPolicy(column).classification !== 'public') return []
  return values
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== '')
    .slice(0, max)
    .map((v) => (v instanceof Date ? v.toISOString() : String(v)).slice(0, 40))
}

export function mappingPrompt(input: { sourceColumns: (Col & { samples: string[] })[]; targetFields: (Col & { label?: string })[] | null; mapped: string[] }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You map columns of a source table to target fields in an HR data integration platform (KMPlus Nexus).
Answer with one JSON object only, no prose:
{"fields":[{"from":"<source column, exactly as given>","to":"<target field>","type":"${COLUMN_TYPES.join('|')}","transforms":[{"fn":"<name>","args":["…"]}],"reason":"<max 12 words>"}]}
Rules:
- "from" must be one of the source columns, spelled exactly. Never invent columns.
- ${input.targetFields ? '"to" must be one of the target fields.' : '"to" is a clear snake_case name (e.g. employee_code, hire_date).'} Each target at most once.
- Only include mappings you are confident about; skip the rest.
- Use transforms only when needed, from this list:
${TRANSFORM_GUIDE}
- Indonesian and SAP names are common: NIP/PERNR = employee code, Nama = name, Tgl Lahir/GBDAT = birth date, Tgl Masuk/BEGDA = hire date, Atasan = manager, Kode Unit/ORGEH = org code, Jabatan/PLANS = position.
- Dates stored as 8 digits (20210315) need format_date ["yyyy-MM-dd","yyyyMMdd"]; dd/mm/yyyy text needs ["yyyy-MM-dd","dd/MM/yyyy"].`,
    },
    { role: 'user', content: JSON.stringify({ sourceColumns: input.sourceColumns, targetFields: input.targetFields, alreadyMapped: input.mapped }) },
  ]
}

const suggestionSchema = z.object({
  fields: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        type: z.string().optional(),
        transforms: z.array(z.object({ fn: z.string(), args: z.array(z.union([z.string(), z.number()])).optional() })).optional(),
        reason: z.string().optional(),
      })
    )
    .max(200),
})

export type MappingSuggestion = MapStep['fields'][number] & { reason: string }

/** Keeps only suggestions that use real source columns, valid targets and known transforms. */
export function checkMapping(answer: unknown, input: { sourceColumns: Col[]; targetFields: Col[] | null; mapped: string[] }): MappingSuggestion[] {
  const parsed = suggestionSchema.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"fields":[{"from","to","type","transforms","reason"}]}.')
  const sources = new Map(input.sourceColumns.map((c) => [c.name.toLowerCase(), c.name]))
  const targets = input.targetFields ? new Map(input.targetFields.map((f) => [f.name.toLowerCase(), f])) : null
  const used = new Set(input.mapped.map((m) => m.toLowerCase()))
  const out: MappingSuggestion[] = []
  for (const f of parsed.data.fields) {
    const from = sources.get(f.from.trim().toLowerCase())
    const to = f.to.trim()
    if (!from || !/^[a-z_][a-z0-9_]{0,62}$/i.test(to) || used.has(to.toLowerCase())) continue
    const target = targets?.get(to.toLowerCase())
    if (targets && !target) continue
    used.add(to.toLowerCase())
    const type = (target?.type ?? f.type ?? 'text') as (typeof COLUMN_TYPES)[number]
    out.push({
      from,
      to: target?.name ?? to.toLowerCase(),
      type: (COLUMN_TYPES as readonly string[]).includes(type) ? type : 'text',
      transforms: (f.transforms ?? []).filter((t) => (TRANSFORMS as readonly string[]).includes(t.fn)).map((t) => ({ fn: t.fn as (typeof TRANSFORMS)[number], args: (t.args ?? []).map(String) })),
      reason: (f.reason ?? '').slice(0, 120),
    })
  }
  return out
}

// ── Business rules from plain language ───────────────────────────────────────

export function rulePrompt(input: { text: string; fields: Col[] }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You turn a business rule written in plain language into a KMPlus Nexus rule. Answer with one JSON object only:
{"name":"<short name>","description":"<one sentence>","body":{"when":{"match":"all|any","conditions":[{"field":"<field>","operator":"<operator>","value":"<text>","valueField":""}],"groups":[]},"then":[<actions>],"otherwise":[<actions>]}}
Operators: ${FILTER_OPERATORS.join(', ')}. Values are always strings; in_list takes "a, b, c"; is_empty/is_not_empty take "". Dates as YYYY-MM-DD. To compare two fields, put the other field in "valueField".
"groups" nests more {"match","conditions","groups"} blocks for mixed AND/OR.
Actions:
{"type":"include"} keep the row; {"type":"exclude"} drop the row
{"type":"set_field","field":"<field>","value":"<text, may contain {other_field}>"}
{"type":"calculate","field":"<field>","expr":<expr>} where expr is {"kind":"field","name":"…"} | {"kind":"value","value":"…"} | {"kind":"op","op":"${EXPR_OPS.join('|')}","left":<expr>,"right":<expr>} | {"kind":"fn","fn":"${EXPR_FNS.join('|')}","args":[<expr>…]} (days_between takes two dates; today takes no args)
{"type":"route","branch":"<branch label of a later Router step>"}
{"type":"notify","message":"<text>","emails":[]}
{"type":"require_approval","reason":"<why>"}
Use only these fields in conditions: ${input.fields.length ? input.fields.map((f) => `${f.name} (${f.type})`).join(', ') : '(none listed: use the names the user wrote, snake_case)'}.
Keep it as simple as the description allows. Use "otherwise" only if the text says what happens when the condition is false.`,
    },
    { role: 'user', content: input.text },
  ]
}

const ruleAnswerSchema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), body: z.unknown() })

function conditionFields(group: RuleBody['when']): string[] {
  return [...group.conditions.flatMap((c) => [c.field, c.valueField].filter(Boolean)), ...group.groups.flatMap(conditionFields)]
}

export function checkRule(answer: unknown, input: { fields: Col[] }): { name: string; description: string; body: RuleBody } {
  const parsed = ruleAnswerSchema.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"name","description","body":{"when","then","otherwise"}}.')
  const body = ruleBodySchema.safeParse(parsed.data.body)
  if (!body.success) {
    const issue = body.error.issues[0]
    throw new AnswerError(`The rule body is invalid at ${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}.`)
  }
  if (body.data.then.some((a) => a.type === 'trigger_pipeline') || body.data.otherwise.some((a) => a.type === 'trigger_pipeline')) {
    throw new AnswerError('Do not use trigger_pipeline.')
  }
  if (input.fields.length) {
    const known = new Set(input.fields.map((f) => f.name))
    const unknown = conditionFields(body.data.when).filter((f) => !known.has(f))
    if (unknown.length) throw new AnswerError(`Unknown field(s) in conditions: ${[...new Set(unknown)].join(', ')}. Use only: ${[...known].join(', ')}.`)
  }
  return { name: parsed.data.name, description: parsed.data.description?.trim() ?? '', body: body.data }
}

// ── Questions about datasets ─────────────────────────────────────────────────

export interface AskDataset {
  name: string
  rowCount: number
  columns: (Col & { masked?: boolean })[]
}

export function askPrompt(input: { question: string; datasets: AskDataset[]; today: string }): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `You answer questions about datasets in KMPlus Nexus by writing ONE chart query (no SQL). Answer with one JSON object only:
{"widget":{"dataset":"<dataset>","type":"${WIDGET_TYPES.join('|')}","title":"<short title>","measure":{"agg":"${AGGREGATIONS.join('|')}","column":"<column or empty for count>"},"dimension":{"column":"<column>","grain":"${GRAINS.join('|')}"} or null,"filters":[{"column":"<column>","op":"${FILTER_OPS.join('|')}","value":"<text>"}],"sort":"${SORTS.join('|')}","limit":<1-100>},"explanation":"<one sentence: what the chart shows>"}
Rules:
- Use only datasets and columns listed. Columns marked masked cannot be used.
- kpi = one number (dimension must be null). bar/table = grouped by a column. line = over time: dimension is a ${TIME_TYPES.join('/')} column with a grain (month, year…).
- sum/avg/min/max need a ${NUMERIC_TYPES.join('/')} column; count needs no column; count_distinct counts different values of a column.
- "Top 5 …" → sort value_desc, limit 5. Filter values are strings; dates YYYY-MM-DD. Today is ${input.today}.
- If the question can't be answered from these columns, still pick the closest chart and say so in "explanation".`,
    },
    { role: 'user', content: JSON.stringify({ question: input.question, datasets: input.datasets }) },
  ]
}

const askAnswerSchema = z.object({ widget: z.record(z.string(), z.unknown()), explanation: z.string().max(500).optional() })

export function checkAsk(answer: unknown, input: { datasets: AskDataset[] }): { widget: Widget; explanation: string } {
  const parsed = askAnswerSchema.safeParse(answer)
  if (!parsed.success) throw new AnswerError('Expected {"widget":{…},"explanation":"…"}.')
  const raw = parsed.data.widget as Record<string, unknown>
  const ds = input.datasets.find((d) => d.name === raw.dataset)
  if (!ds) throw new AnswerError(`Unknown dataset ${JSON.stringify(raw.dataset)}. Use one of: ${input.datasets.map((d) => d.name).join(', ')}.`)
  // Small models write "" or {} for "no dimension".
  if (raw.type === 'kpi' || (raw.dimension && typeof raw.dimension === 'object' && !(raw.dimension as { column?: unknown }).column)) raw.dimension = null
  const widget = widgetSchema.safeParse({ size: 'wide', ...raw, id: 'ask' })
  if (!widget.success) {
    const issue = widget.error.issues[0]
    throw new AnswerError(`The widget is invalid at ${issue?.path.join('.') || 'widget'}: ${issue?.message ?? 'invalid'}.`)
  }
  const w = widget.data
  const cols = new Map(ds.columns.map((c) => [c.name, c]))
  const use = (name: string, what: string) => {
    const c = cols.get(name)
    if (!c) throw new AnswerError(`Column ${name} (${what}) is not in ${ds.name}. Columns: ${ds.columns.map((x) => x.name).join(', ')}.`)
    if (c.masked) throw new AnswerError(`Column ${name} is masked for this user and can't be used.`)
    return c
  }
  if (w.measure.column) {
    const c = use(w.measure.column, 'measure')
    if (['sum', 'avg', 'min', 'max'].includes(w.measure.agg) && !(NUMERIC_TYPES as readonly string[]).includes(c.type) && !(['min', 'max'].includes(w.measure.agg) && (TIME_TYPES as readonly string[]).includes(c.type))) {
      throw new AnswerError(`${w.measure.agg} needs a number column; ${c.name} is ${c.type}.`)
    }
  }
  if (w.dimension) {
    const c = use(w.dimension.column, 'dimension')
    if (w.type === 'line' && !(TIME_TYPES as readonly string[]).includes(c.type)) throw new AnswerError(`A line chart needs a date column to group by; ${c.name} is ${c.type}.`)
  }
  for (const f of w.filters) use(f.column, 'filter')
  return { widget: { ...w, title: w.title || '' }, explanation: parsed.data.explanation?.trim() ?? '' }
}

/** A follow-up message asking the model to fix an answer that failed a check. */
export function repairMessages(previous: string, problem: string): ChatMessage[] {
  return [
    { role: 'assistant', content: previous.slice(0, 8000) },
    { role: 'user', content: `That answer can't be used: ${problem} Reply with the corrected JSON object only.` },
  ]
}
