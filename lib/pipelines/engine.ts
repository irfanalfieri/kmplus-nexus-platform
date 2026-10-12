import { OTHERWISE, stepTitle, topoOrder, type DestinationStep, type PipelineDefinition, type PipelineNode, type Severity, type SourceStep } from './definition'
import { applyMap, matchesFilter, validateRow, type LookupTables, type Row } from './transforms'
import { evalGroup } from './conditions'
import { compareWatermarks, inferColumns, maxWatermark, type OutputColumn, type TypeHints } from './columns'
import type { BusinessRule } from '@/lib/rules/definition'
import { applyRules } from '@/lib/rules/evaluate'

/**
 * Pipeline engine (pure). Runs the definition graph over a batch of rows:
 * nodes in dependency order, rows following edges, a Router splitting them by
 * branch, several Destinations each getting their own rows and columns.
 * Used for chunks of real runs (jobs.ts), test runs and quarantine replays.
 */

export interface StepStat {
  id: string
  type: PipelineNode['type']
  label: string
  rowsIn: number
  rowsOut: number
  /** Rows quarantined (error) or held for approval at this node. */
  rejected: number
  /** Rows passed with a warning/info flag. */
  flagged?: number
  durationMs: number
  /** First rows after this node (test runs only). */
  sample?: Row[]
  error?: string
}

export type QuarantineKind = 'invalid' | 'approval' | 'flag'

export interface Reject {
  stepId: string
  row: Row
  errors: string[]
  severity?: Severity
  /** invalid: not written (error); approval: held until approved; flag: written with a warning/info. */
  kind?: QuarantineKind
}

export interface EngineContext {
  rules: Map<string, BusinessRule>
  /** exists_in lookups: "dataset.column" → values. */
  lookups: Map<string, Set<string>>
  /** Values seen by "unique" rules across the run. */
  seen: Map<string, Set<string>>
  /** Replay of approved rows: approval holds don't apply again. */
  approved?: boolean
  /** Lookup tables for Map "lookup" transforms (MP-6). */
  lookupTables?: LookupTables
}

export function emptyContext(): EngineContext {
  return { rules: new Map(), lookups: new Map(), seen: new Map() }
}

export interface DestinationResult {
  id: string
  kind: string
  target: string
  rowCount?: number
  written?: number
}

export interface EngineResult {
  status: 'success' | 'partial' | 'failed'
  steps: StepStat[]
  rejects: Reject[]
  rejectedCount: number
  flaggedCount?: number
  heldCount?: number
  rowsRead: number
  rowsWritten: number
  columns: OutputColumn[]
  error?: string
  /** false when retrying can't help (bad config, validation abort). */
  retryable?: boolean
  /** First destination (kept for older run records). */
  destination?: { kind: string; target: string; rowCount?: number }
  destinations?: DestinationResult[]
  /** Incremental sync: highest watermark value read this run (null if no rows). */
  watermark?: { column: string; value: string | null }
}

export interface EngineIO {
  read(step: SourceStep): Promise<Row[]>
  /** Omitted for test runs. */
  write?(step: DestinationStep, rows: Row[], columns: OutputColumn[]): Promise<{ written: number; target: string; rowCount?: number }>
}

const MAX_REJECTS_KEPT = 500

/** @deprecated use stepTitle */
export const stepLabel = stepTitle

/** Running totals of a run, persisted between chunks. */
export interface RunTotals {
  steps: StepStat[]
  rowsRead: number
  rowsWritten: number
  rejectedCount: number
  flaggedCount: number
  heldCount: number
  /** Columns of the first destination (older UI) and per destination. */
  columns: OutputColumn[]
  columnsByDest: Record<string, OutputColumn[]>
  writtenByDest: Record<string, number>
  /** "ruleId:then" / "ruleId:otherwise" → rows that took that branch (notify / trigger at the end). */
  ruleHits: Record<string, number>
  watermark?: { column: string; value: string | null }
}

export function newRunTotals(def: PipelineDefinition): RunTotals {
  const order = topoOrder(def.nodes, def.edges) ?? def.nodes
  return {
    steps: order.map((s) => ({ id: s.id, type: s.type, label: stepTitle(s), rowsIn: 0, rowsOut: 0, rejected: 0, flagged: 0, durationMs: 0 })),
    rowsRead: 0,
    rowsWritten: 0,
    rejectedCount: 0,
    flaggedCount: 0,
    heldCount: 0,
    columns: [],
    columnsByDest: {},
    writtenByDest: {},
    ruleHits: {},
  }
}

/** Totals saved before graph pipelines lack the newer counters; fill them in. */
export function upgradeTotals(t: RunTotals): RunTotals {
  return Object.assign({ flaggedCount: 0, heldCount: 0, columnsByDest: {}, writtenByDest: {}, ruleHits: {} }, t)
}

/** Output columns for a destination: declared by the nearest Map upstream, otherwise inferred. */
export function outputColumns(def: PipelineDefinition, rows: Row[], hints: TypeHints = {}, destId?: string): OutputColumn[] {
  const strip = (cols: OutputColumn[]) => cols.filter((c) => !c.name.startsWith('_nexus_'))
  const map = nearestMap(def, destId)
  if (map) {
    const declared: OutputColumn[] = map.fields.map((f) => ({ name: f.to, type: f.type }))
    if (!map.keepUnmapped) return declared
    const names = new Set(declared.map((c) => c.name))
    return strip([...declared, ...inferColumns(rows, hints).filter((c) => !names.has(c.name))])
  }
  return strip(inferColumns(rows, hints))
}

function nearestMap(def: PipelineDefinition, destId?: string) {
  if (!destId) {
    const maps = def.nodes.filter((n) => n.type === 'map')
    return maps[maps.length - 1]?.type === 'map' ? maps[maps.length - 1] : undefined
  }
  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  const queue = [destId]
  const seen = new Set(queue)
  while (queue.length) {
    const id = queue.shift()!
    for (const e of def.edges) {
      if (e.to !== id || seen.has(e.from)) continue
      const n = byId.get(e.from)
      if (n?.type === 'map') return n
      seen.add(e.from)
      queue.push(e.from)
    }
  }
  return undefined
}

/** Nodes downstream of (and including) a node. */
export function descendants(def: PipelineDefinition, nodeId: string): Set<string> {
  const out = new Set([nodeId])
  const stack = [nodeId]
  while (stack.length) {
    const id = stack.pop()!
    for (const e of def.edges) if (e.from === id && !out.has(e.to)) (out.add(e.to), stack.push(e.to))
  }
  return out
}

const stripInternal = (row: Row) => {
  let copy: Row | null = null
  for (const k of Object.keys(row)) {
    if (!k.startsWith('_nexus_')) continue
    copy ??= { ...row }
    delete copy[k]
  }
  return copy ?? row
}



export interface ChunkOutput {
  /** Rows per destination node id. */
  byDestination: Map<string, Row[]>
  /** Quarantined (invalid) and held-for-approval rows. */
  rejects: Reject[]
  /** Rows written with a warning/info flag. */
  flags: Reject[]
  /** manager-rule pairs to check once the run has every row. */
  managerPairs: { nodeId: string; key: string; manager: string; field: string; keyField: string }[]
  /** @deprecated rows of the first destination */
  rows: Row[]
}

/**
 * Runs the graph on one chunk of source rows, adding to `totals`.
 * `startNodeId` (quarantine replay): rows enter at that node instead of the Source.
 * Throws (retryable: false) when a Validate node set to abort fails.
 */
export function transformChunk(
  def: PipelineDefinition,
  input: Row[],
  totals: RunTotals,
  ctxOrSeen: EngineContext | Map<string, Set<string>>,
  hints: TypeHints = {},
  opts: { startNodeId?: string; sample?: number } = {}
): ChunkOutput {
  const ctx: EngineContext = ctxOrSeen instanceof Map ? { ...emptyContext(), seen: ctxOrSeen } : ctxOrSeen
  const order = topoOrder(def.nodes, def.edges) ?? def.nodes
  const active = opts.startNodeId ? descendants(def, opts.startNodeId) : null
  const outputs = new Map<string, Map<string, Row[]>>()
  const result: ChunkOutput = { byDestination: new Map(), rejects: [], flags: [], managerPairs: [], rows: [] }
  const statOf = (id: string) => {
    let s = totals.steps.find((x) => x.id === id)
    if (!s) {
      const n = def.nodes.find((x) => x.id === id)!
      s = { id, type: n.type, label: stepTitle(n), rowsIn: 0, rowsOut: 0, rejected: 0, flagged: 0, durationMs: 0 }
      totals.steps.push(s)
    }
    return s
  }
  const take = (rows: Row[]) => (opts.sample ? rows.slice(0, opts.sample) : undefined)

  for (const node of order) {
    if (active && !active.has(node.id)) continue
    const stat = statOf(node.id)
    const started = Date.now()
    let rows: Row[]
    if (node.type === 'source' || node.id === opts.startNodeId) rows = input
    else {
      rows = []
      for (const e of def.edges) if (e.to === node.id) rows.push(...(outputs.get(e.from)?.get(e.branch || '') ?? []))
    }
    const out = new Map<string, Row[]>()
    stat.rowsIn += node.type === 'source' ? 0 : rows.length

    switch (node.type) {
      case 'source': {
        stat.rowsOut += rows.length
        totals.rowsRead += rows.length
        if (node.mode === 'incremental') totals.watermark ??= { column: node.watermarkColumn, value: null }
        if (node.mode === 'incremental' && rows.length) {
          if (!(node.watermarkColumn in rows[0])) {
            throw Object.assign(new Error(`Watermark column "${node.watermarkColumn}" is not in ${node.table}.`), { retryable: false })
          }
          const chunkMax = maxWatermark(rows, node.watermarkColumn)
          const prev = totals.watermark?.value ?? null
          const value = prev === null ? chunkMax : chunkMax === null ? prev : compareWatermarks(chunkMax, prev) > 0 ? chunkMax : prev
          totals.watermark = { column: node.watermarkColumn, value }
        }
        out.set('', rows)
        break
      }
      case 'filter': {
        const kept = rows.filter((r) => matchesFilter(r, node, ctx.rules))
        stat.rowsOut += kept.length
        out.set('', kept)
        break
      }
      case 'map': {
        const next: Row[] = []
        for (const r of rows) {
          const { row, errors } = applyMap(r, node, ctx.lookupTables)
          if (errors.length) {
            stat.rejected++
            totals.rejectedCount++
            result.rejects.push({ stepId: node.id, row: r, errors, severity: 'error', kind: 'invalid' })
          } else next.push(row)
        }
        stat.rowsOut += next.length
        out.set('', next)
        break
      }
      case 'validate': {
        const next: Row[] = []
        for (const r of rows) {
          const issues = validateRow(r, node, { ...ctx, managerPairs: result.managerPairs, nodeId: node.id })
          const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message)
          if (errors.length) {
            if (node.onFail === 'abort') throw Object.assign(new Error(`${stepTitle(node)}: Validation failed: ${errors.join('; ')}`), { retryable: false })
            stat.rejected++
            totals.rejectedCount++
            result.rejects.push({ stepId: node.id, row: r, errors, severity: 'error', kind: 'invalid' })
            continue
          }
          const notes = issues.filter((i) => i.severity !== 'error')
          if (notes.length) {
            stat.flagged = (stat.flagged ?? 0) + 1
            totals.flaggedCount++
            result.flags.push({ stepId: node.id, row: r, errors: notes.map((i) => i.message), severity: notes.some((i) => i.severity === 'warning') ? 'warning' : 'info', kind: 'flag' })
          }
          next.push(r)
        }
        stat.rowsOut += next.length
        out.set('', next)
        break
      }
      case 'rules': {
        const next: Row[] = []
        const rules = node.ruleIds.map((ruleId) => {
          const rule = ctx.rules.get(ruleId)
          if (!rule) throw Object.assign(new Error(`Business rule ${ruleId} not found (deleted?)`), { retryable: false })
          return rule
        })
        for (const original of rows) {
          const { row: r, keep, hold, failure, hits } = applyRules(rules, original, { approved: ctx.approved })
          // notify / trigger_pipeline run once per run, from ruleHits (jobs.ts).
          for (const h of hits) totals.ruleHits[h] = (totals.ruleHits[h] ?? 0) + 1
          if (failure) {
            stat.rejected++
            totals.rejectedCount++
            result.rejects.push({ stepId: node.id, row: original, errors: [failure], severity: 'error', kind: 'invalid' })
          } else if (hold && keep) {
            stat.rejected++
            totals.heldCount++
            result.rejects.push({ stepId: node.id, row: original, errors: [`Needs approval (${hold})`], severity: 'info', kind: 'approval' })
          } else if (keep) next.push(r)
        }
        stat.rowsOut += next.length
        out.set('', next)
        break
      }
      case 'router': {
        for (const b of node.branches) out.set(b.id, [])
        out.set(OTHERWISE, [])
        for (const r of rows) {
          const routed = typeof r._nexus_route === 'string' ? node.branches.find((b) => b.label === r._nexus_route) : undefined
          const branch =
            routed ??
            node.branches.find((b) => {
              if (b.ruleId) {
                const rule = ctx.rules.get(b.ruleId)
                if (!rule) throw Object.assign(new Error(`Business rule ${b.ruleId} not found (deleted?)`), { retryable: false })
                return evalGroup(r, rule.when)
              }
              return b.condition ? evalGroup(r, b.condition) : false
            })
          out.get(branch ? branch.id : OTHERWISE)!.push(r)
        }
        stat.rowsOut += rows.length
        break
      }
      case 'destination': {
        const clean = rows.map(stripInternal)
        if (clean.length) {
          const known = new Set((totals.columnsByDest[node.id] ?? []).map((c) => c.name))
          totals.columnsByDest[node.id] = [...(totals.columnsByDest[node.id] ?? []), ...outputColumns(def, clean, hints, node.id).filter((c) => !known.has(c.name))]
          if (!totals.columns.length || node.id === firstDestination(def)?.id) totals.columns = totals.columnsByDest[node.id]
        }
        result.byDestination.set(node.id, clean)
        if (node.id === firstDestination(def)?.id) result.rows = clean
        out.set('', clean)
        break
      }
    }
    outputs.set(node.id, out)
    if (opts.sample) stat.sample = take([...out.values()].flat())
    stat.durationMs += Date.now() - started
  }
  return result
}

export function firstDestination(def: PipelineDefinition) {
  return def.nodes.find((n): n is DestinationStep => n.type === 'destination')
}

/** Checks a destination can take its output; call before the first write. */
export function checkDestination(def: PipelineDefinition, columns: OutputColumn[], dest: DestinationStep | undefined = firstDestination(def)) {
  if (!dest) return
  if (!columns.length) throw new Error(`${stepTitle(dest)}: no output columns. Add a Map step or check the source.`)
  const names = new Set(columns.map((c) => c.name))
  const missingKeys = dest.keys.filter((k) => !names.has(k))
  if ((dest.mode === 'upsert' || dest.mode === 'replace') && missingKeys.length) {
    throw Object.assign(new Error(`${stepTitle(dest)}: ${dest.mode === 'upsert' ? 'upsert' : 'replay'} key column(s) not in output: ${missingKeys.join(', ')}`), { retryable: false })
  }
}

/** Final status of a finished run. */
export function totalsStatus(totals: RunTotals): 'success' | 'partial' {
  return totals.rejectedCount > 0 || totals.heldCount > 0 ? 'partial' : 'success'
}

/**
 * Test runs (and single-batch runs in tests): reads the source once, runs the
 * graph, optionally writes. Failures in I/O nodes are retryable; transforms
 * are deterministic.
 */
export async function runEngine(def: PipelineDefinition, io: EngineIO, opts: { sampleSize?: number; context?: Partial<EngineContext> } = {}): Promise<EngineResult> {
  const totals = newRunTotals(def)
  const ctx: EngineContext = { ...emptyContext(), ...opts.context }
  const source = def.nodes.find((n): n is SourceStep => n.type === 'source')!
  const sample = io.write ? undefined : (opts.sampleSize ?? 25)
  const destinations: DestinationResult[] = []
  const fail = (step: PipelineNode, err: unknown, ioStep: boolean, rejects: Reject[] = []): EngineResult => {
    const stat = totals.steps.find((s) => s.id === step.id)
    const message = err instanceof Error ? err.message : String(err)
    if (stat) stat.error = message
    const retryable = (err as { retryable?: boolean }).retryable !== false && ioStep
    return {
      status: 'failed', steps: totals.steps, rejects, rejectedCount: totals.rejectedCount, rowsRead: totals.rowsRead, rowsWritten: totals.rowsWritten,
      columns: totals.columns, error: `${stepTitle(step)}: ${message}`.replace(/^(.*?): \1: /, '$1: '), retryable, destinations,
    }
  }

  let rows: Row[]
  const readStarted = Date.now()
  try {
    rows = await io.read(source)
  } catch (err) {
    return fail(source, err, true)
  }
  const sourceStat = totals.steps.find((s) => s.id === source.id)
  if (sourceStat) sourceStat.durationMs += Date.now() - readStarted

  let out: ChunkOutput
  try {
    out = transformChunk(def, rows, totals, ctx, {}, { sample })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const failing = def.nodes.find((n) => msg.startsWith(stepTitle(n))) ?? def.nodes.find((n) => n.type === 'validate') ?? source
    const stat = totals.steps.find((s) => s.id === failing.id)
    if (stat) stat.error = msg
    return { status: 'failed', steps: totals.steps, rejects: [], rejectedCount: totals.rejectedCount, rowsRead: totals.rowsRead, rowsWritten: 0, columns: totals.columns, error: msg, retryable: false, watermark: totals.watermark }
  }

  for (const dest of def.nodes.filter((n): n is DestinationStep => n.type === 'destination')) {
    const destRows = out.byDestination.get(dest.id) ?? []
    const columns = totals.columnsByDest[dest.id] ?? outputColumns(def, [], {}, dest.id)
    try {
      if (destRows.length) checkDestination(def, columns, dest)
      if (dest.mode === 'upsert' && !destRows.length) checkDestination(def, columns.length ? columns : [{ name: '_', type: 'text' }], { ...dest, keys: [] })
    } catch (err) {
      return fail(dest, err, false, out.rejects)
    }
    if (io.write) {
      const started = Date.now()
      try {
        const res = await io.write(dest, destRows, columns)
        totals.rowsWritten += res.written
        destinations.push({ id: dest.id, kind: dest.kind, target: res.target, rowCount: res.rowCount, written: res.written })
      } catch (err) {
        return fail(dest, err, true, out.rejects)
      }
      const stat = totals.steps.find((s) => s.id === dest.id)
      if (stat) stat.durationMs += Date.now() - started
    }
    const stat = totals.steps.find((s) => s.id === dest.id)
    if (stat) stat.rowsOut += destRows.length
  }

  return {
    status: totalsStatus(totals),
    steps: totals.steps,
    rejects: [...out.rejects, ...out.flags].slice(0, MAX_REJECTS_KEPT),
    rejectedCount: totals.rejectedCount,
    flaggedCount: totals.flaggedCount,
    heldCount: totals.heldCount,
    rowsRead: totals.rowsRead,
    rowsWritten: totals.rowsWritten,
    columns: totals.columns,
    destination: destinations[0],
    destinations,
    watermark: totals.watermark,
  }
}
