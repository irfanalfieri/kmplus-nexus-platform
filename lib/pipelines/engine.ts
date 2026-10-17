import { OTHERWISE, stepTitle, topoOrder, type AggregateStep, type ApiCallStep, type DedupeStep, type EnrichStep, type DestinationStep, type JoinStep, type PipelineDefinition, type PipelineNode, type Severity, type SourceStep } from './definition'
import { checkText } from './check-messages'
import { applyMap, matchesFilter, validateRow, type LookupTables, type Row } from './transforms'
import { evalGroup } from './conditions'
import { mapOutputColumns, splitRow } from './nested'
import { compareWatermarks, inferColumns, maxWatermark, type OutputColumn, type TypeHints } from './columns'
import type { BusinessRule } from '@/lib/rules/definition'
import { applyRules } from '@/lib/rules/evaluate'
import { describeKey, joinKey, joinRows } from './join'
import { isBlocking, joinPrefix, lanePlan, laneLabel, passNodes, unionLabel, type LanePlan } from './lanes'
import { aggregateOutputTypes, aggregateRows, dedupeKey, dedupeRows, duplicateMessage } from './aggregate'
import { applyEnrich, type EnrichOutcome } from './api-calls'

/**
 * Pipeline engine (pure). Runs the definition graph over a batch of rows:
 * nodes in dependency order, rows following edges, a Router splitting them by
 * branch, several Destinations each getting their own rows and columns.
 * Used for chunks of real runs (jobs.ts), test runs and quarantine replays.
 *
 * Several sources (lanes, lib/pipelines/lanes.ts): a chunk enters at one
 * Source; a Join looks up the staged partners of the chunk's keys through
 * `EngineContext.joinPartners` (the only I/O, injected); rows reaching a Join's
 * right side are handed back in `toStage` for the caller to stage.
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
  /** Join: left rows that found a partner, extra rows from several matches, rows staged on the right side. */
  matched?: number
  multiplied?: number
  staged?: number
  /** Enrich / "Changes data": requests sent, and rows answered from the cache. */
  calls?: number
  cached?: number
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
  /** Join lookups: the staged rows of these (normalized) keys, grouped by key, and the staged side's columns. */
  joinPartners?: (join: JoinStep, keys: string[]) => Promise<StagedPartners>
  /** API calls of Enrich and "Changes data" steps (lib/pipelines/api-runtime.ts); the only other I/O, injected. */
  api?: {
    enrich(step: EnrichStep, rows: Row[]): Promise<{ outcomes: EnrichOutcome[]; calls: number; cached: number }>
    call(step: ApiCallStep, rows: Row[]): Promise<{ outcomes: ({ kind: 'ok'; answer: Row; sent: boolean } | { kind: 'refused'; message: string })[]; calls: number }>
  }
}

export interface StagedPartners {
  partners: Map<string, Row[]>
  columns: string[]
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
  /** Per incremental Source, by step id (several sources). */
  watermarks?: Record<string, { column: string; value: string | null }>
  /** Rows read into run staging (lanes on the right side of a Join). */
  stagedRows?: number
}

export interface EngineIO {
  read(step: SourceStep): Promise<Row[]>
  /** Test runs: only the rows whose key column matches these normalized keys (null when the source can't filter). */
  readByKeys?(step: SourceStep, column: string, keys: string[], normalize: JoinStep['normalize']): Promise<Row[] | null>
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
  /** The driver's incremental watermark (older UI and pipeline state). */
  watermark?: { column: string; value: string | null }
  /** Every incremental Source's watermark, by step id. */
  watermarks?: Record<string, { column: string; value: string | null }>
  /** Rows read into run staging (not counted in rowsRead). */
  stagedRows?: number
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
    // Dotted outputs (address.city) are one json column per group (MP-7).
    const declared: OutputColumn[] = mapOutputColumns(map.fields).map((c) => ({ name: c.name, type: c.type }))
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
      // Rows past a Join or Union carry columns no single Map declares: infer them.
      if (n?.type === 'join' || n?.type === 'union' || n?.type === 'aggregate' || n?.type === 'split') return undefined
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
  /** Rows that reached a Join's right side, by Join id (staged by the caller in a stage pass, else ignored). */
  toStage: Map<string, Row[]>
  /** @deprecated rows of the first destination */
  rows: Row[]
}

/**
 * Runs the graph on one chunk of source rows, adding to `totals`.
 * `entry`: the Source the rows were read from (default: the driver).
 * `startNodeId` (quarantine replay): rows enter at that node instead.
 * `stage`: a stage pass (rows read for a Join's right side, counted as staged).
 * `finish` (with `startNodeId` = a blocking step): the rows are that step's
 * answer and continue after it. Rows reaching any other blocking step come back
 * in `toStage`, like a Join's right side.
 * Throws (retryable: false) when a Validate node set to abort fails.
 */
export async function transformChunk(
  def: PipelineDefinition,
  input: Row[],
  totals: RunTotals,
  ctxOrSeen: EngineContext | Map<string, Set<string>>,
  hints: TypeHints = {},
  opts: { startNodeId?: string; sample?: number; entry?: string; stage?: boolean; finish?: boolean } = {}
): Promise<ChunkOutput> {
  const ctx: EngineContext = ctxOrSeen instanceof Map ? { ...emptyContext(), seen: ctxOrSeen } : ctxOrSeen
  const order = topoOrder(def.nodes, def.edges) ?? def.nodes
  const plan = lanePlan(def)
  const entry = opts.startNodeId ?? opts.entry ?? plan.driver ?? order.find((n) => n.type === 'source')?.id ?? ''
  const active = passNodes(def, entry, { blocking: true })
  const outputs = new Map<string, Map<string, Row[]>>()
  const result: ChunkOutput = { byDestination: new Map(), rejects: [], flags: [], managerPairs: [], rows: [], toStage: new Map() }
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
  const inputsOf = (nodeId: string, side: 'right' | 'other') => def.edges.filter((e) => e.to === nodeId && active.has(e.from) && (e.port === 'right') === (side === 'right'))
  const rowsFrom = (e: { from: string; branch?: string }) => outputs.get(e.from)?.get(e.branch || '') ?? []

  for (const node of order) {
    if (!active.has(node.id)) continue
    const stat = statOf(node.id)
    const started = Date.now()
    let rows: Row[]
    if (node.id === entry) rows = input
    else {
      rows = []
      for (const e of inputsOf(node.id, 'other')) rows.push(...rowsFrom(e))
    }
    const out = new Map<string, Row[]>()
    // A finish pass's rows are the step's answer: its input was counted when it was staged.
    stat.rowsIn += node.type === 'source' || (opts.finish && node.id === entry) ? 0 : rows.length

    switch (node.type) {
      case 'source': {
        stat.rowsOut += rows.length
        if (opts.stage) totals.stagedRows = (totals.stagedRows ?? 0) + rows.length
        else totals.rowsRead += rows.length
        if (node.mode === 'incremental') {
          totals.watermarks ??= {}
          const prev = totals.watermarks[node.id]?.value ?? null
          let value = prev
          if (rows.length) {
            if (!(node.watermarkColumn in rows[0])) {
              throw Object.assign(new Error(`Watermark column "${node.watermarkColumn}" is not in ${node.table}.`), { retryable: false })
            }
            const chunkMax = maxWatermark(rows, node.watermarkColumn)
            value = prev === null ? chunkMax : chunkMax === null ? prev : compareWatermarks(chunkMax, prev) > 0 ? chunkMax : prev
          }
          totals.watermarks[node.id] = { column: node.watermarkColumn, value }
          if (node.id === plan.driver) totals.watermark = { column: node.watermarkColumn, value }
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
          const { row, errors, notes } = applyMap(r, node, ctx.lookupTables)
          if (errors.length) {
            stat.rejected++
            totals.rejectedCount++
            result.rejects.push({ stepId: node.id, row: r, errors, severity: 'error', kind: 'invalid' })
            continue
          }
          if (notes.length) {
            // relate set to "flag": written without the reference, listed in Data quality.
            stat.flagged = (stat.flagged ?? 0) + 1
            totals.flaggedCount++
            result.flags.push({ stepId: node.id, row: r, errors: notes, severity: 'warning', kind: 'flag' })
          }
          next.push(row)
        }
        stat.rowsOut += next.length
        out.set('', next)
        break
      }
      case 'split': {
        const next: Row[] = []
        for (const r of rows) {
          const { rows: items, truncated } = splitRow(r, node)
          if (truncated) {
            stat.flagged = (stat.flagged ?? 0) + 1
            totals.flaggedCount++
            result.flags.push({ stepId: node.id, row: r, errors: [checkText('splitTruncated', { path: node.path, count: items.length + truncated, max: node.maxItems })], severity: 'warning', kind: 'flag' })
          }
          next.push(...items)
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
            result.rejects.push({ stepId: node.id, row: original, errors: [checkText('needsApproval', { reason: hold })], severity: 'info', kind: 'approval' })
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
      case 'join': {
        // Right side: handed back for staging (ignored outside a stage pass).
        const right: Row[] = []
        for (const e of inputsOf(node.id, 'right')) right.push(...rowsFrom(e))
        if (right.length) {
          result.toStage.set(node.id, [...(result.toStage.get(node.id) ?? []), ...right.map(stripInternal)])
          stat.staged = (stat.staged ?? 0) + right.length
        }
        out.set('', await joinChunk(def, plan, node, rows, ctx, totals, stat, result))
        break
      }
      case 'aggregate':
      case 'dedupe': {
        if (node.id === entry && opts.finish) {
          // The step's answer (finish pass): it continues after the step.
          stat.rowsOut += rows.length
          out.set('', rows)
        } else if (isBlocking(node)) {
          // Needs every row: staged until the finish pass.
          if (rows.length) result.toStage.set(node.id, [...(result.toStage.get(node.id) ?? []), ...rows.map(stripInternal)])
          out.set('', [])
        } else {
          out.set('', dedupeFirst(node as DedupeStep, rows, ctx, totals, stat, result))
        }
        break
      }
      case 'enrich': {
        out.set('', await enrichChunk(node, rows, ctx, totals, stat, result))
        break
      }
      case 'apicall': {
        out.set('', await apiCallChunk(node, rows, ctx, totals, stat, result))
        break
      }
      case 'union': {
        const next: Row[] = []
        if (node.id === entry) next.push(...rows)
        else {
          for (const e of inputsOf(node.id, 'other')) {
            const label = node.sourceColumn ? unionLabel(def, plan, node, e.from) : ''
            for (const r of rowsFrom(e)) next.push(node.sourceColumn ? { ...r, [node.sourceColumn]: label } : r)
          }
        }
        stat.rowsOut += next.length
        out.set('', next)
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
    if (opts.sample && !stat.sample?.length) stat.sample = take([...out.values()].flat())
    stat.durationMs += Date.now() - started
  }
  return result
}

const noApi = (node: PipelineNode) => Object.assign(new Error(`${stepTitle(node)}: API calls are not available here.`), { retryable: false })

/** Enrich: ask the API (or the cache) about each row and merge the answer in (pure merge: lib/pipelines/api-calls.ts). */
async function enrichChunk(node: EnrichStep, rows: Row[], ctx: EngineContext, totals: RunTotals, stat: StepStat, result: ChunkOutput): Promise<Row[]> {
  if (!rows.length) return []
  if (!ctx.api) throw noApi(node)
  const { outcomes, calls, cached } = await ctx.api.enrich(node, rows)
  stat.calls = (stat.calls ?? 0) + calls
  stat.cached = (stat.cached ?? 0) + cached
  const res = applyEnrich(node, rows, outcomes)
  stat.matched = (stat.matched ?? 0) + res.matched
  stat.multiplied = (stat.multiplied ?? 0) + res.multiplied
  stat.rowsOut += res.rows.length
  const request = `${node.method} ${node.path}`
  for (const u of res.unmatched) result.rejects.push({ stepId: node.id, row: u, errors: [checkText('enrichNoMatch', { request })], severity: 'error', kind: 'invalid' })
  for (const r of res.refused) result.rejects.push({ stepId: node.id, row: r.row, errors: [`${request}: ${r.message}`], severity: 'error', kind: 'invalid' })
  stat.rejected += res.unmatched.length + res.refused.length
  totals.rejectedCount += res.unmatched.length + res.refused.length
  return res.rows
}

/** "Changes data": create (or update) each row's record once, then continue with the answer's values. */
async function apiCallChunk(node: ApiCallStep, rows: Row[], ctx: EngineContext, totals: RunTotals, stat: StepStat, result: ChunkOutput): Promise<Row[]> {
  if (!rows.length) return []
  if (!ctx.api) throw noApi(node)
  const { outcomes, calls } = await ctx.api.call(node, rows)
  stat.calls = (stat.calls ?? 0) + calls
  const next: Row[] = []
  const request = `${node.create.method} ${node.create.path}`
  rows.forEach((row, i) => {
    const o = outcomes[i]
    if (o?.kind === 'ok') return next.push({ ...row, ...o.answer })
    stat.rejected++
    totals.rejectedCount++
    result.rejects.push({ stepId: node.id, row, errors: [`${request}: ${o?.message ?? 'not sent'}`], severity: 'error', kind: 'invalid' })
  })
  stat.rowsOut += next.length
  return next
}

export const dedupeSeenField = (nodeId: string) => `__dedupe:${nodeId}`

/** Deduplicate keeping the first row read: streams, remembering keys across chunks in `ctx.seen` (persisted per run). */
function dedupeFirst(node: DedupeStep, rows: Row[], ctx: EngineContext, totals: RunTotals, stat: StepStat, result: ChunkOutput): Row[] {
  const field = dedupeSeenField(node.id)
  let seen = ctx.seen.get(field)
  if (!seen) ctx.seen.set(field, (seen = new Set()))
  const next: Row[] = []
  for (const r of rows) {
    const k = dedupeKey(r, node)
    if (k === null || !seen.has(k)) {
      if (k !== null) seen.add(k)
      next.push(r)
      continue
    }
    if (node.flagRemoved) {
      stat.flagged = (stat.flagged ?? 0) + 1
      totals.flaggedCount++
      result.flags.push({ stepId: node.id, row: r, errors: [duplicateMessage(node, r, r)], severity: 'info', kind: 'flag' })
    }
  }
  stat.rowsOut += next.length
  return next
}

/** A finish pass of a blocking step over rows held in memory (test runs): its answer, and flags for removed duplicates. */
export function finishInMemory(node: AggregateStep | DedupeStep, rows: Row[], totals: RunTotals): { rows: Row[]; flags: Reject[] } {
  if (node.type === 'aggregate') return { rows: aggregateRows(node, rows), flags: [] }
  const { rows: kept, removed } = dedupeRows(node, rows)
  const flags: Reject[] = node.flagRemoved ? removed.map((r) => ({ stepId: node.id, row: r.row, errors: [r.message], severity: 'info' as const, kind: 'flag' as const })) : []
  const stat = totals.steps.find((s) => s.id === node.id)
  if (stat) stat.flagged = (stat.flagged ?? 0) + flags.length
  totals.flaggedCount += flags.length
  return { rows: kept, flags }
}

/** A Join's left rows: look up the staged partners of their keys, then join (pure, lib/pipelines/join.ts). */
async function joinChunk(def: PipelineDefinition, plan: LanePlan, node: JoinStep, rows: Row[], ctx: EngineContext, totals: RunTotals, stat: StepStat, result: ChunkOutput): Promise<Row[]> {
  if (!rows.length) return []
  if (!ctx.joinPartners) throw Object.assign(new Error(`${stepTitle(node)}: the right side was not staged.`), { retryable: false })
  const leftCols = node.keys.map((k) => k.left)
  const keys = [...new Set(rows.map((r) => joinKey(r, leftCols, node.normalize)).filter((k): k is string => k !== null))]
  const { partners, columns } = keys.length ? await ctx.joinPartners(node, keys) : { partners: new Map<string, Row[]>(), columns: [] as string[] }
  const res = joinRows(node, rows, partners, { prefix: joinPrefix(def, plan, node), rightColumns: columns })
  stat.matched = (stat.matched ?? 0) + res.matched
  stat.multiplied = (stat.multiplied ?? 0) + res.multiplied
  stat.rowsOut += res.rows.length
  if (res.unmatched.length) {
    const staged = plan.joins.find((j) => j.id === node.id)
    const lane = staged ? laneLabel(def, plan, staged.rightFrom) : 'the right side'
    for (const u of res.unmatched) {
      stat.rejected++
      totals.rejectedCount++
      result.rejects.push({ stepId: node.id, row: u, errors: [checkText('joinNoMatch', { lane, keys: describeKey(u, leftCols) })], severity: 'error', kind: 'invalid' })
    }
  }
  return res.rows
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
 * Test runs (and single-batch runs in tests): runs the plan's passes once, in
 * memory (lib/pipelines/lanes.ts planPasses), and optionally writes. A Join
 * whose right lanes keep their key (`pushdownColumn`) reads, in a test run,
 * only the rows of the keys that reach it (`readByKeys`); other right sides are
 * read in full by their pass first. Blocking steps answer over every row their
 * passes produced (in a test run: the sample only).
 * Failures in I/O nodes are retryable; transforms are deterministic.
 */
export async function runEngine(def: PipelineDefinition, io: EngineIO, opts: { sampleSize?: number; context?: Partial<EngineContext> } = {}): Promise<EngineResult> {
  const totals = newRunTotals(def)
  const plan = lanePlan(def)
  const sample = io.write ? undefined : (opts.sampleSize ?? 25)
  const destinations: DestinationResult[] = []
  const nodeOf = (id: string) => def.nodes.find((n) => n.id === id)!
  const ctx: EngineContext = { ...emptyContext(), ...opts.context }
  // Rows staged so far, per Join (right side) or blocking step.
  const staged = new Map<string, Row[]>()
  const lazy = new Set(plan.joins.filter((j) => io.readByKeys && j.sources.every((s) => pushdownColumn(def, nodeOf(j.id) as JoinStep, s))).map((j) => j.id))
  ctx.joinPartners ??= stagedLookup(def, plan, io, totals, ctx, staged, lazy, sample)
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

  const byDestination = new Map<string, Row[]>()
  const rejects: Reject[] = []
  const flags: Reject[] = []
  for (const pass of plan.passes) {
    // Right sides read by key on demand (see stagedLookup).
    if (pass.kind === 'source' && pass.staged && pass.sinks.length && pass.sinks.every((s) => lazy.has(s))) continue
    const entry = nodeOf(pass.id)
    let rows: Row[]
    let hints: TypeHints = {}
    if (entry.type === 'source') {
      const readStarted = Date.now()
      try {
        rows = await io.read(entry)
      } catch (err) {
        return fail(entry, err, true)
      }
      const sourceStat = totals.steps.find((s) => s.id === entry.id)
      if (sourceStat) sourceStat.durationMs += Date.now() - readStarted
    } else {
      const done = finishInMemory(entry as AggregateStep | DedupeStep, staged.get(pass.id) ?? [], totals)
      rows = done.rows
      flags.push(...done.flags)
      if (entry.type === 'aggregate') hints = aggregateOutputTypes(entry, Object.fromEntries(inferColumns(staged.get(pass.id) ?? []).map((c) => [c.name, c.type])))
    }

    try {
      const out = await transformChunk(def, rows, totals, ctx, hints, entry.type === 'source' ? { sample, entry: pass.id, stage: pass.staged } : { sample, startNodeId: pass.id, finish: true })
      for (const [id, destRows] of out.byDestination) byDestination.set(id, [...(byDestination.get(id) ?? []), ...destRows])
      for (const [id, stageRows] of out.toStage) staged.set(id, [...(staged.get(id) ?? []), ...stageRows])
      rejects.push(...out.rejects)
      flags.push(...out.flags)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      const failing = def.nodes.find((n) => msg.startsWith(stepTitle(n))) ?? def.nodes.find((n) => n.type === 'validate') ?? entry
      const stat = totals.steps.find((s) => s.id === failing.id)
      if (stat) stat.error = msg
      const ioFailure = (err as { retryable?: boolean }).retryable !== false && failing.type === 'source'
      return { status: 'failed', steps: totals.steps, rejects: [], rejectedCount: totals.rejectedCount, rowsRead: totals.rowsRead, rowsWritten: 0, columns: totals.columns, error: msg, retryable: ioFailure, watermark: totals.watermark }
    }
  }

  for (const dest of def.nodes.filter((n): n is DestinationStep => n.type === 'destination')) {
    const destRows = byDestination.get(dest.id) ?? []
    const columns = totals.columnsByDest[dest.id] ?? outputColumns(def, [], {}, dest.id)
    try {
      if (destRows.length) checkDestination(def, columns, dest)
      if (dest.mode === 'upsert' && !destRows.length) checkDestination(def, columns.length ? columns : [{ name: '_', type: 'text' }], { ...dest, keys: [] })
    } catch (err) {
      return fail(dest, err, false, rejects)
    }
    if (io.write) {
      const started = Date.now()
      try {
        const res = await io.write(dest, destRows, columns)
        totals.rowsWritten += res.written
        destinations.push({ id: dest.id, kind: dest.kind, target: res.target, rowCount: res.rowCount, written: res.written })
      } catch (err) {
        return fail(dest, err, true, rejects)
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
    rejects: [...rejects, ...flags].slice(0, MAX_REJECTS_KEPT),
    rejectedCount: totals.rejectedCount,
    flaggedCount: totals.flaggedCount,
    heldCount: totals.heldCount,
    rowsRead: totals.rowsRead,
    rowsWritten: totals.rowsWritten,
    columns: totals.columns,
    destination: destinations[0],
    destinations,
    watermark: totals.watermark,
    watermarks: totals.watermarks,
    stagedRows: totals.stagedRows,
  }
}

/**
 * A Join's right side for runEngine: rows its passes staged in memory, or, for
 * a lane whose key reaches the Join unchanged, only the rows of the asked keys
 * (`readByKeys`), read through the lane's own steps when they are asked for.
 */
function stagedLookup(def: PipelineDefinition, plan: LanePlan, io: EngineIO, totals: RunTotals, ctx: EngineContext, staged: Map<string, Row[]>, lazy: Set<string>, sample?: number) {
  const sourceOf = (id: string) => def.nodes.find((n): n is SourceStep => n.type === 'source' && n.id === id)!
  const readLane = async (join: JoinStep, sourceId: string, keys: string[]): Promise<Row[]> => {
    const source = sourceOf(sourceId)
    let rows: Row[] | null = null
    try {
      const column = pushdownColumn(def, join, sourceId)
      if (column) rows = await io.readByKeys!(source, column, keys, join.normalize)
      rows ??= await io.read(source)
    } catch (err) {
      throw Object.assign(new Error(`${stepTitle(source)}: ${err instanceof Error ? err.message : String(err)}`), { retryable: (err as { retryable?: boolean }).retryable })
    }
    const out = await transformChunk(def, rows, totals, ctx, {}, { entry: sourceId, stage: true, sample })
    return out.toStage.get(join.id) ?? []
  }
  return async (join: JoinStep, keys: string[]): Promise<StagedPartners> => {
    const lane = plan.joins.find((j) => j.id === join.id)
    if (!lane) throw Object.assign(new Error(`${stepTitle(join)}: connect exactly one input to each side (left and right).`), { retryable: false })
    const rows: Row[] = []
    if (lazy.has(join.id)) for (const s of lane.sources) rows.push(...(await readLane(join, s, keys)))
    else rows.push(...(staged.get(join.id) ?? []))
    const wanted = new Set(keys)
    const partners = new Map<string, Row[]>()
    const cols = new Set<string>()
    const rightCols = join.keys.map((k) => k.right)
    for (const r of rows) {
      for (const c of Object.keys(r)) cols.add(c)
      const k = joinKey(r, rightCols, join.normalize)
      if (k !== null && wanted.has(k)) partners.set(k, [...(partners.get(k) ?? []), r])
    }
    return { partners, columns: [...cols] }
  }
}

/**
 * The source column a sample test can filter a staged lane by: the Join's first
 * right key, when it reaches the Join unchanged (only Filter, Validate or Router
 * steps between the Source and the Join). Null otherwise.
 */
export function pushdownColumn(def: PipelineDefinition, join: JoinStep, sourceId: string): string | null {
  const path = passNodes(def, sourceId)
  for (const id of path) {
    const n = def.nodes.find((x) => x.id === id)
    if (!n || id === sourceId || id === join.id) continue
    if (n.type !== 'filter' && n.type !== 'validate' && n.type !== 'router') return null
  }
  return path.has(join.id) ? (join.keys[0]?.right ?? null) : null
}
