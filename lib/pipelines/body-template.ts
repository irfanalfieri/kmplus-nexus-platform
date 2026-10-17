/**
 * REST API destinations: request bodies built from a pasted example.
 *
 * The user pastes an example body (JSON, form-encoded or XML). It becomes a
 * tree (`BodyNode`, lib/pipelines/definition.ts) whose leaves are bound to an
 * incoming column, a fixed value, an expression (`Expr`, the same JSON tree as
 * business rules) or run information. There is no template language: values
 * are only ever placed into the tree and serialized, so nothing in a row can
 * change the body's shape or inject markup. A list marked "rows" carries one
 * item per row (batch mode); otherwise each row is its own request.
 *
 * Pure and client-safe (the editor's dry run uses the same rendering as runs).
 */
import { evalExpr, isEmpty, type Row } from './conditions'
import { checkText } from './check-messages'
import { readPath } from './nested'
import { suggestCanonicalField } from '@/lib/domain/model'
import { isBatchBody, PATH_PLACEHOLDER, walkBody, type ApiDestinationSpec, type BodyFormat, type BodyNode, type BodyValueType, type Expr } from './definition'

export const BODY_CONTENT_TYPES: Record<BodyFormat, string> = {
  json: 'application/json',
  form: 'application/x-www-form-urlencoded',
  xml: 'application/xml',
}

// ── Parsing a pasted example ─────────────────────────────────────────────────

export type SampleErrorCode = 'empty' | 'tooLarge' | 'json' | 'formNested' | 'form' | 'xml' | 'xmlDoctype'
export class BodySampleError extends Error {
  constructor(
    readonly code: SampleErrorCode,
    readonly detail = ''
  ) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

const MAX_SAMPLE = 50_000

const valueNode = (type: BodyValueType = 'auto'): BodyNode => ({ t: 'value', type, binding: { kind: 'none' }, required: false, empty: 'null' })

/** Type suggested by an example text value (XML and form examples are all text). */
function typeOfText(text: string): BodyValueType {
  const s = text.trim()
  if (/^-?(0|[1-9]\d{0,14})$/.test(s)) return 'integer'
  if (/^-?(0|[1-9]\d*)\.\d+$/.test(s)) return 'number'
  if (/^(true|false)$/i.test(s)) return 'boolean'
  return 'string'
}

function fromJson(v: unknown, top: boolean): BodyNode {
  if (Array.isArray(v)) {
    const items = v.map((x) => fromJson(x, false))
    return { t: 'array', items: top ? 'rows' : 'row', item: items.length ? items.reduce(mergeNodes) : valueNode('string') }
  }
  if (v && typeof v === 'object') return { t: 'object', fields: Object.entries(v as Record<string, unknown>).map(([key, x]) => ({ key, node: fromJson(x, false) })) }
  if (typeof v === 'number') return valueNode(Number.isInteger(v) ? 'integer' : 'number')
  if (typeof v === 'boolean') return valueNode('boolean')
  if (typeof v === 'string') return valueNode('string')
  return valueNode('auto')
}

/** Two examples of the same place (array items): union of object keys, first one wins otherwise. */
function mergeNodes(a: BodyNode, b: BodyNode): BodyNode {
  if (a.t === 'object' && b.t === 'object') {
    const fields = a.fields.map((f) => {
      const other = b.fields.find((g) => g.key === f.key)
      return other ? { key: f.key, node: mergeNodes(f.node, other.node) } : f
    })
    for (const g of b.fields) if (!fields.some((f) => f.key === g.key)) fields.push(g)
    return { t: 'object', fields }
  }
  if (a.t === 'array' && b.t === 'array') return { ...a, item: mergeNodes(a.item, b.item) }
  if (a.t === 'value' && b.t === 'value' && a.type === 'auto') return b
  return a
}

function parseForm(text: string): BodyNode {
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const node = parseJsonSample(trimmed)
    if (node.t !== 'object' || node.fields.some((f) => f.node.t !== 'value')) throw new BodySampleError('formNested')
    return node
  }
  const fields: { key: string; node: BodyNode }[] = []
  for (const part of trimmed.split(/&|\r?\n/)) {
    if (!part.trim()) continue
    const eq = part.indexOf('=')
    let key: string
    let value: string
    try {
      key = decodeURIComponent((eq < 0 ? part : part.slice(0, eq)).replace(/\+/g, ' ')).trim()
      value = eq < 0 ? '' : decodeURIComponent(part.slice(eq + 1).replace(/\+/g, ' '))
    } catch {
      throw new BodySampleError('form', part.slice(0, 40))
    }
    if (!key) throw new BodySampleError('form', part.slice(0, 40))
    if (!fields.some((f) => f.key === key)) fields.push({ key, node: valueNode(typeOfText(value)) })
  }
  if (!fields.length) throw new BodySampleError('empty')
  return { t: 'object', fields }
}

function parseJsonSample(text: string): BodyNode {
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch (err) {
    throw new BodySampleError('json', err instanceof Error ? err.message.slice(0, 120) : '')
  }
  if (v === null || typeof v !== 'object') throw new BodySampleError('json', 'an object or a list')
  return fromJson(v, true)
}

// A deliberately small XML reader for examples: elements, attributes, text,
// CDATA and the five predefined entities. No DTDs or custom entities (refused),
// so nothing can expand or reach outside the pasted text.
interface XmlElement {
  name: string
  attrs: [string, string][]
  children: XmlElement[]
  text: string
}

const XML_NAME_RE = /^[A-Za-z_][A-Za-z0-9_.:-]*/
const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-z]+);?/g, (m, e: string) => {
    if (!m.endsWith(';')) throw new BodySampleError('xml', `"${m}"`)
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16))
    if (e.startsWith('#')) return String.fromCodePoint(parseInt(e.slice(1), 10))
    if (!(e in ENTITIES)) throw new BodySampleError('xml', `&${e};`)
    return ENTITIES[e]
  })
}

export function parseXml(src: string): XmlElement {
  if (/<!DOCTYPE|<!ENTITY/i.test(src)) throw new BodySampleError('xmlDoctype')
  const s = src.replace(/^﻿/, '')
  let i = 0
  const stack: XmlElement[] = []
  let root: XmlElement | null = null
  const fail = (what: string): never => {
    throw new BodySampleError('xml', `${what} (at character ${i + 1})`)
  }
  while (i < s.length) {
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i)
      if (end < 0) fail('unclosed <?')
      i = end + 2
    } else if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i)
      if (end < 0) fail('unclosed comment')
      i = end + 3
    } else if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i)
      if (end < 0) fail('unclosed CDATA')
      if (!stack.length) fail('text outside the root element')
      stack[stack.length - 1].text += s.slice(i + 9, end)
      i = end + 3
    } else if (s.startsWith('</', i)) {
      const m = XML_NAME_RE.exec(s.slice(i + 2))
      const name = m?.[0] ?? ''
      const close = s.indexOf('>', i)
      if (!name || close < 0) fail('broken closing tag')
      const open = stack.pop()
      if (!open || open.name !== name) fail(`</${name}> doesn't match <${open?.name ?? ''}>`)
      i = close + 1
    } else if (s[i] === '<') {
      const m = XML_NAME_RE.exec(s.slice(i + 1))
      if (!m) fail('broken tag')
      const el: XmlElement = { name: m![0], attrs: [], children: [], text: '' }
      i += 1 + m![0].length
      let selfClosing = false
      for (;;) {
        while (/\s/.test(s[i] ?? '')) i++
        if (s.startsWith('/>', i)) {
          i += 2
          selfClosing = true
          break
        }
        if (s[i] === '>') {
          i++
          break
        }
        const a = XML_NAME_RE.exec(s.slice(i))
        if (!a) fail(`broken attribute in <${el.name}>`)
        i += a![0].length
        while (/\s/.test(s[i] ?? '')) i++
        if (s[i] !== '=') fail(`attribute ${a![0]} has no value`)
        i++
        while (/\s/.test(s[i] ?? '')) i++
        const q = s[i]
        if (q !== '"' && q !== "'") fail(`attribute ${a![0]} isn't quoted`)
        const end = s.indexOf(q, i + 1)
        if (end < 0) fail(`attribute ${a![0]} isn't closed`)
        el.attrs.push([a![0], decodeEntities(s.slice(i + 1, end))])
        i = end + 1
      }
      const parent = stack[stack.length - 1]
      if (parent) parent.children.push(el)
      else if (root) fail('two root elements')
      else root = el
      if (!selfClosing) stack.push(el)
      if (stack.length > 50) fail('nested too deeply')
    } else {
      const next = s.indexOf('<', i)
      const text = s.slice(i, next < 0 ? s.length : next)
      if (text.trim()) {
        if (!stack.length) fail('text outside the root element')
        stack[stack.length - 1].text += decodeEntities(text)
      }
      i = next < 0 ? s.length : next
    }
  }
  if (stack.length) fail(`<${stack[stack.length - 1].name}> isn't closed`)
  if (!root) throw new BodySampleError('empty')
  return root
}

function fromXml(el: XmlElement): BodyNode {
  const fields: { key: string; node: BodyNode }[] = el.attrs.map(([name, value]) => ({ key: `@${name}`, node: valueNode(typeOfText(value)) }))
  const groups = new Map<string, XmlElement[]>()
  for (const c of el.children) groups.set(c.name, [...(groups.get(c.name) ?? []), c])
  for (const [name, els] of groups) {
    const nodes = els.map(fromXml)
    fields.push({ key: name, node: els.length > 1 ? { t: 'array', items: 'row', item: nodes.reduce(mergeNodes) } : nodes[0] })
  }
  if (!fields.length) return valueNode(el.text.trim() ? typeOfText(el.text) : 'string')
  if (el.text.trim()) fields.push({ key: '#text', node: valueNode(typeOfText(el.text)) })
  return { t: 'object', fields }
}

/** The body tree of a pasted example. Throws BodySampleError (with a code the editor translates). */
export function parseBodySample(format: BodyFormat, text: string): BodyNode {
  if (!text.trim()) throw new BodySampleError('empty')
  if (text.length > MAX_SAMPLE) throw new BodySampleError('tooLarge')
  if (format === 'json') return parseJsonSample(text)
  if (format === 'form') return parseForm(text)
  const root = parseXml(text)
  return { t: 'object', fields: [{ key: root.name, node: fromXml(root) }] }
}

// ── Editing the tree ─────────────────────────────────────────────────────────

/** Address of a node: field indexes, 0 for an array's item. */
export type BodyAddress = number[]

export interface BodyLeaf {
  addr: BodyAddress
  path: string
  /** Name used to match columns: the key, or the element name for XML text. */
  name: string
  parent: string
  inRows: boolean
  node: Extract<BodyNode, { t: 'value' }>
}

/** Every value of the tree, in order, with its address and display path. */
export function bodyLeaves(template: BodyNode): BodyLeaf[] {
  const out: BodyLeaf[] = []
  const walk = (n: BodyNode, addr: BodyAddress, path: string, name: string, parent: string, inRows: boolean) => {
    if (n.t === 'value') out.push({ addr, path, name, parent, inRows, node: n })
    else if (n.t === 'array') walk(n.item, [...addr, 0], `${path}[]`, name, parent, inRows || n.items === 'rows')
    else
      n.fields.forEach((f, i) => {
        const leafName = f.key === '#text' ? name : f.key.replace(/^@/, '')
        walk(f.node, [...addr, i], path ? `${path}.${f.key}` : f.key, leafName, f.key === '#text' ? parent : name, inRows)
      })
  }
  walk(template, [], '', '', '', false)
  return out
}

/** Arrays of the tree with their addresses (the editor offers each as "one item per row"). */
export function bodyArrays(template: BodyNode): { addr: BodyAddress; path: string; items: 'rows' | 'row'; nested: boolean }[] {
  const out: { addr: BodyAddress; path: string; items: 'rows' | 'row'; nested: boolean }[] = []
  const walk = (n: BodyNode, addr: BodyAddress, path: string, inArray: boolean) => {
    if (n.t === 'array') {
      out.push({ addr, path: `${path}[]`, items: n.items, nested: inArray })
      walk(n.item, [...addr, 0], `${path}[]`, true)
    } else if (n.t === 'object') n.fields.forEach((f, i) => walk(f.node, [...addr, i], path ? `${path}.${f.key}` : f.key, inArray))
  }
  walk(template, [], '', false)
  return out
}

/** XML elements under the root that could repeat once per row (not attributes, text, or inside a list). */
export function bodyRepeatables(template: BodyNode): { addr: BodyAddress; path: string }[] {
  const out: { addr: BodyAddress; path: string }[] = []
  const walk = (n: BodyNode, addr: BodyAddress, path: string) => {
    if (n.t !== 'object') return
    n.fields.forEach((f, i) => {
      if (f.key.startsWith('@') || f.key === '#text' || f.node.t === 'array') return
      const p = path ? `${path}.${f.key}` : f.key
      if (addr.length >= 1) out.push({ addr: [...addr, i], path: p })
      walk(f.node, [...addr, i], p)
    })
  }
  walk(template, [], '')
  return out
}

/** Copies the settings of values (and the rows list) from an older tree to the same paths of a new one. */
export function carryOverBody(next: BodyNode, previous: BodyNode): BodyNode {
  const old = new Map(bodyLeaves(previous).map((l) => [l.path, l.node]))
  let out = next
  for (const leaf of bodyLeaves(next)) {
    const before = old.get(leaf.path)
    if (before) out = updateBodyNode(out, leaf.addr, (n) => (n.t === 'value' ? { ...before } : n))
  }
  const rows = bodyArrays(previous).find((a) => a.items === 'rows')
  const same = rows && bodyArrays(out).find((a) => a.path === rows.path && !a.nested)
  return same ? setRowsArray(out, same.addr) : out
}

/** Replaces the node at an address. */
export function updateBodyNode(template: BodyNode, addr: BodyAddress, fn: (n: BodyNode) => BodyNode): BodyNode {
  if (!addr.length) return fn(template)
  const [head, ...rest] = addr
  if (template.t === 'array') return { ...template, item: updateBodyNode(template.item, rest, fn) }
  if (template.t === 'object') return { ...template, fields: template.fields.map((f, i) => (i === head ? { ...f, node: updateBodyNode(f.node, rest, fn) } : f)) }
  return template
}

/** Makes the array at `addr` the list of rows (batch mode); null = one request per row. */
export function setRowsArray(template: BodyNode, addr: BodyAddress | null): BodyNode {
  const reset = (n: BodyNode): BodyNode =>
    n.t === 'array' ? { ...n, items: 'row', item: reset(n.item) } : n.t === 'object' ? { ...n, fields: n.fields.map((f) => ({ ...f, node: reset(f.node) })) } : n
  const cleared = reset(template)
  return addr ? updateBodyNode(cleared, addr, (n) => (n.t === 'array' ? { ...n, items: 'rows' } : n)) : cleared
}

/** Makes an XML element repeat (an array of it), e.g. <employee> inside <employees>. */
export function repeatElement(template: BodyNode, addr: BodyAddress): BodyNode {
  return updateBodyNode(template, addr, (n) => (n.t === 'array' ? n : { t: 'array', items: 'row', item: n }))
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Best column for a leaf name: same name, parent + name (employee.code ↔ employee_code), then HR synonyms. */
export function matchColumn(name: string, parent: string, columns: string[]): string | null {
  const n = norm(name)
  if (!n) return null
  const exact = columns.find((c) => norm(c) === n)
  if (exact) return exact
  const compound = parent ? columns.find((c) => norm(c) === norm(parent + name)) : undefined
  if (compound) return compound
  const canonical = suggestCanonicalField(name)
  if (!canonical) return null
  return columns.find((c) => norm(c) === norm(canonical) || suggestCanonicalField(c) === canonical) ?? null
}

/** Binds unbound leaves inside the rows (or every leaf, when each row is its own request) to matching columns. */
export function autoBindBody(template: BodyNode, columns: string[]): { template: BodyNode; bound: number } {
  const batch = isBatchBody(template)
  let next = template
  let bound = 0
  for (const leaf of bodyLeaves(template)) {
    if (leaf.node.binding.kind !== 'none' || (batch && !leaf.inRows)) continue
    const column = matchColumn(leaf.name, leaf.parent, columns)
    if (!column) continue
    next = updateBodyNode(next, leaf.addr, (n) => (n.t === 'value' ? { ...n, binding: { kind: 'column', column } } : n))
    bound++
  }
  return { template: next, bound }
}

/** Columns a body sends (directly or through an expression), for the personal-data warning. */
export function bodyColumns(template: BodyNode, path = ''): string[] {
  const out = new Set<string>()
  const fromExpr = (e: Expr) => {
    if (e.kind === 'field') out.add(e.name)
    else if (e.kind === 'op') (fromExpr(e.left), fromExpr(e.right))
    else if (e.kind === 'fn') e.args.forEach(fromExpr)
  }
  walkBody(template, (n) => {
    if (n.t !== 'value') return
    if (n.binding.kind === 'column') out.add(n.binding.column)
    if (n.binding.kind === 'expr') fromExpr(n.binding.expr)
  })
  for (const m of path.matchAll(PATH_PLACEHOLDER)) out.add(m[1])
  return [...out]
}

// ── Rendering ────────────────────────────────────────────────────────────────

export interface RenderContext {
  runId: string
  chunk: number
  /** Position of the first row within its chunk (keeps batch numbers stable when rows arrive in parts). */
  rowOffset?: number
  now?: Date
}

export interface RenderedRequest {
  /** Indexes into the rows passed in. */
  rowIndexes: number[]
  /** Stable within a run: chunk and batch (or row) number. */
  batchId: string
  path: string
  body: string
  contentType: string
}

export interface RenderResult {
  requests: RenderedRequest[]
  /** Rows that could not be turned into a request (missing required value, wrong type …). */
  rejects: { rowIndex: number; errors: string[] }[]
}

const OMIT = Symbol('omit')
type Out = unknown

function trueish(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['true', '1', 'yes', 'y', 'ya', 't'].includes(s)) return true
  if (['false', '0', 'no', 'n', 'tidak', 'f'].includes(s)) return false
  return null
}

/** A value converted to the leaf's type; throws a check message. */
export function convertBodyValue(v: unknown, type: BodyValueType): unknown {
  if (v instanceof Date) v = v.toISOString()
  if (typeof v === 'bigint') v = v.toString()
  switch (type) {
    case 'auto':
      return v
    case 'string':
      return typeof v === 'object' ? JSON.stringify(v) : String(v)
    case 'number': {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      if (!Number.isFinite(n) || String(v).trim() === '') throw new Error(checkText('notNumber', { value: String(v).slice(0, 60) }))
      return n
    }
    case 'integer': {
      const n = typeof v === 'number' ? v : Number(String(v).trim())
      if (!Number.isInteger(n) || String(v).trim() === '') throw new Error(checkText('notInteger', { value: String(v).slice(0, 60) }))
      return n
    }
    case 'boolean': {
      const b = trueish(v)
      if (b === null) throw new Error(checkText('notBoolean', { value: String(v).slice(0, 60) }))
      return b
    }
  }
}

interface RenderState {
  row: Row
  meta: { run_id: string; batch_id: string; row_count: number; now: string }
  errors: string[]
  /** Items of the rows array, rendered beforehand (batch mode). */
  rowItems?: Out[]
}

function renderValue(n: Extract<BodyNode, { t: 'value' }>, path: string, st: RenderState): Out {
  let v: unknown
  const b = n.binding
  try {
    v = b.kind === 'column' ? readPath(st.row, b.column) : b.kind === 'constant' ? b.value : b.kind === 'expr' ? evalExpr(st.row, b.expr) : b.kind === 'meta' ? st.meta[b.name] : null
  } catch (err) {
    st.errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    return OMIT
  }
  if (v === undefined || isEmpty(v)) {
    if (n.required) {
      st.errors.push(checkText('required', { field: path }))
      return OMIT
    }
    // A fixed "" stays "" when sent as text.
    if (b.kind === 'constant' && n.empty !== 'omit' && n.type !== 'number' && n.type !== 'integer' && n.type !== 'boolean') return ''
    return n.empty === 'omit' ? OMIT : n.empty === 'empty' ? '' : null
  }
  try {
    if (Array.isArray(v)) return v.map((x) => convertBodyValue(x, n.type))
    return convertBodyValue(v, n.type)
  } catch (err) {
    st.errors.push(`${path}: ${err instanceof Error ? err.message : String(err)}`)
    return OMIT
  }
}

function renderNode(n: BodyNode, path: string, st: RenderState): Out {
  if (n.t === 'value') return renderValue(n, path || 'body', st)
  if (n.t === 'array') {
    if (n.items === 'rows') return st.rowItems ?? []
    // One item from the current row (phase 1). A list value bound to a plain leaf is sent as the list.
    const item = renderNode(n.item, `${path}[]`, st)
    if (item === OMIT || item === null) return []
    return n.item.t === 'value' && Array.isArray(item) ? item : [item]
  }
  const obj: Record<string, Out> = {}
  for (const f of n.fields) {
    const v = renderNode(f.node, path ? `${path}.${f.key}` : f.key, st)
    if (v !== OMIT) obj[f.key] = v
  }
  return obj
}

/** The item of the rows array (batch mode). */
function rowsItem(template: BodyNode): { node: BodyNode; path: string } | null {
  let found: { node: BodyNode; path: string } | null = null
  walkBody(template, (n, path) => {
    if (!found && n.t === 'array' && n.items === 'rows') found = { node: n.item, path: `${path}[]` }
  })
  return found
}

// ── Serializing ──

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
// Characters XML 1.0 can't carry at all are dropped rather than producing a broken document.
const xmlText = (v: unknown) => xmlEscape((v instanceof Object ? JSON.stringify(v) : String(v)).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, ''))

function xmlElement(name: string, v: Out): string {
  if (Array.isArray(v)) return v.map((x) => xmlElement(name, x)).join('')
  if (v === null || v === undefined || v === '') return `<${name}/>`
  if (typeof v !== 'object') return `<${name}>${xmlText(v)}</${name}>`
  const o = v as Record<string, Out>
  let attrs = ''
  let inner = ''
  for (const [k, x] of Object.entries(o)) {
    if (k.startsWith('@')) {
      if (x !== null && x !== undefined) attrs += ` ${k.slice(1)}="${xmlText(x)}"`
    } else if (k === '#text') {
      if (x !== null && x !== undefined) inner += xmlText(x)
    } else inner += xmlElement(k, x)
  }
  return inner ? `<${name}${attrs}>${inner}</${name}>` : `<${name}${attrs}/>`
}

export function serializeBody(format: BodyFormat, value: Out): string {
  if (format === 'json') return JSON.stringify(value)
  if (format === 'form') {
    const params = new URLSearchParams()
    for (const [k, v] of Object.entries((value ?? {}) as Record<string, Out>)) params.append(k, v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
    return params.toString()
  }
  const [[root, inner]] = Object.entries((value ?? {}) as Record<string, Out>)
  return `<?xml version="1.0" encoding="UTF-8"?>${xmlElement(root, inner)}`
}

/** The request path for a row: {{column}} placeholders take the row's value, URL-encoded. Unknown names stay for the data source's variables. */
export function renderPath(path: string, row: Row): { path: string } | { error: string } {
  let error = ''
  const out = path.replace(new RegExp(PATH_PLACEHOLDER.source, 'g'), (m, name: string) => {
    if (!(name in row)) return m
    const v = row[name]
    if (isEmpty(v)) {
      error ||= checkText('required', { field: name })
      return ''
    }
    const text = v instanceof Date ? v.toISOString() : String(v)
    // "." and ".." would move the request to another path (the URL parser resolves them).
    if (/^\s*\.+\s*$/.test(text)) {
      error ||= checkText('apiPathValue', { field: name, value: text.trim() })
      return ''
    }
    return encodeURIComponent(text)
  })
  return error ? { error } : { path: out }
}

/** Requests for a set of rows, and the rows that can't be sent. */
export function renderRequests(spec: Pick<ApiDestinationSpec, 'path' | 'body' | 'batchSize'>, rows: Row[], ctx: RenderContext): RenderResult {
  const { format, template } = spec.body
  const contentType = BODY_CONTENT_TYPES[format]
  const now = (ctx.now ?? new Date()).toISOString()
  const offset = ctx.rowOffset ?? 0
  const requests: RenderedRequest[] = []
  const rejects: RenderResult['rejects'] = []
  const item = isBatchBody(template) ? rowsItem(template) : null

  if (!item) {
    rows.forEach((row, i) => {
      const batchId = `${ctx.runId}:${ctx.chunk}:${offset + i}`
      const st: RenderState = { row, meta: { run_id: ctx.runId, batch_id: batchId, row_count: 1, now }, errors: [] }
      const value = renderNode(template, '', st)
      const p = renderPath(spec.path, row)
      if ('error' in p) st.errors.push(p.error)
      if (st.errors.length) return rejects.push({ rowIndex: i, errors: st.errors })
      requests.push({ rowIndexes: [i], batchId, path: (p as { path: string }).path, body: serializeBody(format, value === OMIT ? {} : value), contentType })
    })
    return { requests, rejects }
  }

  const size = Math.max(1, spec.batchSize)
  // Batches are fixed slices of the chunk, so a batch keeps its number when the chunk is written again.
  const first = Math.floor(offset / size)
  const last = Math.floor((offset + rows.length - 1) / size)
  for (let b = first; rows.length && b <= last; b++) {
    const batchId = `${ctx.runId}:${ctx.chunk}:${b}`
    const meta = { run_id: ctx.runId, batch_id: batchId, row_count: 0, now }
    const items: Out[] = []
    const indexes: number[] = []
    for (let i = Math.max(0, b * size - offset); i < Math.min(rows.length, (b + 1) * size - offset); i++) {
      const st: RenderState = { row: rows[i], meta, errors: [] }
      const v = renderNode(item.node, item.path, st)
      if (st.errors.length) {
        rejects.push({ rowIndex: i, errors: st.errors })
        continue
      }
      if (v !== OMIT) {
        items.push(v)
        indexes.push(i)
      }
    }
    if (!indexes.length) continue
    meta.row_count = indexes.length
    const st: RenderState = { row: {}, meta, errors: [], rowItems: items }
    const value = renderNode(template, '', st)
    // Outside the rows only fixed values are allowed; an error there concerns the whole request.
    if (st.errors.length) {
      for (const i of indexes) rejects.push({ rowIndex: i, errors: st.errors })
      continue
    }
    requests.push({ rowIndexes: indexes, batchId, path: spec.path, body: serializeBody(format, value), contentType })
  }
  return { requests, rejects }
}

// ── Responses ────────────────────────────────────────────────────────────────

function getPath(obj: unknown, path: string): unknown {
  let cur = obj
  for (const part of path.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

/**
 * Items a batch response says were refused, e.g. `{"errors":[{"index":2,"message":"…"}]}`
 * with path "errors". Entries may also be plain indexes. Out-of-range indexes are ignored.
 */
export function extractRejectedItems(payload: unknown, cfg: ApiDestinationSpec['response'], itemCount: number): { index: number; message: string }[] {
  if (!cfg.rejectedPath) return []
  const list = getPath(payload, cfg.rejectedPath)
  if (!Array.isArray(list)) return []
  const out = new Map<number, string>()
  for (const entry of list) {
    const raw = entry !== null && typeof entry === 'object' ? getPath(entry, cfg.indexField) : entry
    const index = Number(raw) - cfg.indexBase
    if (!Number.isInteger(index) || index < 0 || index >= itemCount || out.has(index)) continue
    const msg = entry !== null && typeof entry === 'object' ? getPath(entry, cfg.messageField) : undefined
    out.set(index, shortApiMessage(msg === undefined ? '' : typeof msg === 'string' ? msg : JSON.stringify(msg)))
  }
  return [...out].map(([index, message]) => ({ index, message }))
}

/**
 * A short message from an API's answer, safe to keep with a quarantined row:
 * the API's own message field when it has one, emails and long numbers
 * (NIK, phone, account) blanked, at most 160 characters.
 */
export function shortApiMessage(text: string): string {
  let s = text.trim()
  if (s.startsWith('{')) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>
      const pick = ['message', 'error_description', 'error', 'detail', 'title', 'errors'].map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== '')
      if (pick !== undefined) s = typeof pick === 'string' ? pick : JSON.stringify(pick)
    } catch {
      /* not JSON: use as is */
    }
  }
  s = s
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '[number]')
    .replace(/\s+/g, ' ')
    .trim()
  return s.length > 160 ? `${s.slice(0, 157)}…` : s || 'no details'
}

export type StatusClass = 'ok' | 'retry' | 'reject' | 'signin' | 'redirect'

/** What a response status means for the rows of a request. */
export function classifyStatus(status: number): StatusClass {
  if (status >= 200 && status < 300) return 'ok'
  if (status === 408 || status === 425 || status === 429 || status >= 500) return 'retry'
  if (status === 401 || status === 403) return 'signin'
  if (status >= 300 && status < 400) return 'redirect'
  return 'reject'
}

/** Retry-After in ms (seconds or an HTTP date), capped at a minute; null when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | null {
  if (!header) return null
  const s = header.trim()
  if (/^\d+$/.test(s)) return Math.min(60_000, Number(s) * 1000)
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : Math.min(60_000, Math.max(0, t - now))
}

/** Wait before retry `attempt` (1, 2, …): the API's Retry-After when given, else 1 s, 2 s, 4 s … up to 30 s. */
export function retryDelayMs(attempt: number, retryAfter: number | null): number {
  return retryAfter ?? Math.min(30_000, 1000 * 2 ** (attempt - 1))
}

/** Attempts per request before the chunk fails (the run then retries from its last checkpoint). */
export const API_MAX_ATTEMPTS = 4

/**
 * Source rows per chunk for a pipeline writing to an API: a chunk must finish
 * well inside one worker invocation, so at the rate limit it takes about 40 s.
 */
export function apiChunkRows(spec: Pick<ApiDestinationSpec, 'body' | 'batchSize' | 'maxRequestsPerSecond'>): number {
  const perRequest = isBatchBody(spec.body.template) ? spec.batchSize : 1
  return Math.max(20, Math.min(20_000, Math.floor(spec.maxRequestsPerSecond * 40 * perRequest)))
}
