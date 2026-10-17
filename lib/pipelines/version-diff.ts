import { stepTitle, type PipelineDefinition, type PipelineNode } from './definition'

/**
 * Visual diff between two pipeline versions (VC-3). Pure and client-safe;
 * covered by scripts/engine-tests.ts. Steps are matched by id (the editor
 * keeps ids across saves), so a step is added, removed, changed or the same;
 * Map steps also list their field mapping changes, and the connections,
 * run settings and schedule are compared.
 */

export type StepStatus = 'added' | 'removed' | 'changed' | 'same'

export interface FieldChange {
  /** Dotted path inside the step, e.g. `mode`, `keys`, `branches.0.label`. */
  path: string
  from: string
  to: string
}

export interface MappingChange {
  field: string
  kind: 'added' | 'removed' | 'changed'
  from?: string
  to?: string
}

export interface StepDiff {
  id: string
  type: string
  title: string
  status: StepStatus
  changes: FieldChange[]
  mapping: MappingChange[]
}

export interface VersionDiff {
  steps: StepDiff[]
  edges: { added: string[]; removed: string[] }
  settings: FieldChange[]
  schedule: FieldChange[]
  summary: { added: number; removed: number; changed: number; same: number }
}

/** Step keys that aren't changes: where it sits on the canvas, and what identifies it. */
const STEP_KEYS = new Set(['position', 'id', 'type'])
const NONE: ReadonlySet<string> = new Set()

const show = (v: unknown): string => {
  if (v === undefined || v === null || v === '') return '∅'
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

/** Leaf-level differences between two values (objects recurse; arrays of primitives compare whole). */
export function deepChanges(a: unknown, b: unknown, path = '', out: FieldChange[] = [], ignore: ReadonlySet<string> = NONE): FieldChange[] {
  if (JSON.stringify(a) === JSON.stringify(b)) return out
  const isObj = (v: unknown) => v !== null && typeof v === 'object'
  const primitiveList = (v: unknown) => Array.isArray(v) && v.every((x) => !isObj(x))
  if (isObj(a) && isObj(b) && !primitiveList(a) && !primitiveList(b)) {
    const keys = [...new Set([...Object.keys(a as object), ...Object.keys(b as object)])]
    for (const k of keys) {
      if (!path && ignore.has(k)) continue
      deepChanges((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out)
    }
    return out
  }
  out.push({ path: path || 'value', from: show(a), to: show(b) })
  return out
}

type MapField = { from: string; to: string; type: string; transforms: unknown[] }
const transformText = (f: MapField) => (f.transforms?.length ? ` + ${f.transforms.length} transform${f.transforms.length > 1 ? 's' : ''}` : '')
const fieldText = (f: MapField) => `${f.from} (${f.type})${transformText(f)}`

/** Field mapping changes of a Map step, by output field name. */
export function mappingChanges(before: MapField[], after: MapField[]): MappingChange[] {
  const a = new Map(before.map((f) => [f.to, f]))
  const b = new Map(after.map((f) => [f.to, f]))
  const out: MappingChange[] = []
  for (const [to, f] of b) {
    const old = a.get(to)
    if (!old) out.push({ field: to, kind: 'added', to: fieldText(f) })
    else if (JSON.stringify(old) !== JSON.stringify(f)) out.push({ field: to, kind: 'changed', from: fieldText(old), to: fieldText(f) })
  }
  for (const [to, f] of a) if (!b.has(to)) out.push({ field: to, kind: 'removed', from: fieldText(f) })
  return out
}

/** Step order for display: following the edges from the sources, then anything left. */
function ordered(nodes: PipelineNode[], edges: { from: string; to: string }[]): PipelineNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const out: PipelineNode[] = []
  const queue = nodes.filter((n) => n.type === 'source').map((n) => n.id)
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id) || !byId.has(id)) continue
    seen.add(id)
    out.push(byId.get(id)!)
    for (const e of edges) if (e.from === id) queue.push(e.to)
  }
  for (const n of nodes) if (!seen.has(n.id)) out.push(n)
  return out
}

/** Compares two versions (null = nothing before, e.g. the first version). */
export function diffVersions(
  before: { definition: PipelineDefinition; schedule?: unknown } | null,
  after: { definition: PipelineDefinition; schedule?: unknown }
): VersionDiff {
  const oldNodes = new Map((before?.definition.nodes ?? []).map((n) => [n.id, n]))
  const newNodes = new Map(after.definition.nodes.map((n) => [n.id, n]))
  const steps: StepDiff[] = []
  for (const n of ordered(after.definition.nodes, after.definition.edges)) {
    const old = oldNodes.get(n.id)
    if (!old) {
      steps.push({ id: n.id, type: n.type, title: stepTitle(n), status: 'added', changes: [], mapping: n.type === 'map' ? mappingChanges([], n.fields as MapField[]) : [] })
      continue
    }
    const mapping = n.type === 'map' && old.type === 'map' ? mappingChanges(old.fields as MapField[], n.fields as MapField[]) : []
    const changes = deepChanges(old.type === 'map' ? { ...old, fields: undefined } : old, n.type === 'map' ? { ...n, fields: undefined } : n, '', [], STEP_KEYS)
    if (old.type !== n.type) changes.unshift({ path: 'type', from: old.type, to: n.type })
    steps.push({ id: n.id, type: n.type, title: stepTitle(n), status: changes.length || mapping.length ? 'changed' : 'same', changes, mapping })
  }
  for (const n of ordered(before?.definition.nodes ?? [], before?.definition.edges ?? [])) {
    if (!newNodes.has(n.id)) steps.push({ id: n.id, type: n.type, title: stepTitle(n), status: 'removed', changes: [], mapping: [] })
  }
  const edgeName = (e: { from: string; to: string; branch?: string; port?: string }, nodes: Map<string, PipelineNode>) => {
    const t = (id: string) => (nodes.get(id) ? stepTitle(nodes.get(id)!) : id)
    return `${t(e.from)} → ${t(e.to)}${e.port ? ` (${e.port})` : ''}`
  }
  const key = (e: { from: string; to: string; branch?: string; port?: string }) => `${e.from}>${e.to}>${e.branch ?? ''}>${e.port ?? ''}`
  const oldEdges = new Map((before?.definition.edges ?? []).map((e) => [key(e), e]))
  const newEdges = new Map(after.definition.edges.map((e) => [key(e), e]))
  const edges = {
    added: [...newEdges].filter(([k]) => !oldEdges.has(k)).map(([, e]) => edgeName(e, newNodes)),
    removed: [...oldEdges].filter(([k]) => !newEdges.has(k)).map(([, e]) => edgeName(e, oldNodes)),
  }
  const count = (s: StepStatus) => steps.filter((x) => x.status === s).length
  return {
    steps,
    edges,
    settings: deepChanges(before?.definition.settings ?? {}, after.definition.settings ?? {}),
    schedule: deepChanges(before?.schedule ?? {}, after.schedule ?? {}),
    summary: { added: count('added'), removed: count('removed'), changed: count('changed'), same: count('same') },
  }
}
