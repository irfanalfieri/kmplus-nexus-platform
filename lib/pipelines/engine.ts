import type { DestinationStep, PipelineDefinition, PipelineStep, SourceStep } from './definition'
import { applyMap, matchesFilter, validateRow, type Row } from './transforms'
import { compareWatermarks, inferColumns, maxWatermark, type OutputColumn } from './columns'

export interface StepStat {
  id: string
  type: PipelineStep['type']
  label: string
  rowsIn: number
  rowsOut: number
  rejected: number
  durationMs: number
  /** First rows after this step (test runs only). */
  sample?: Row[]
  error?: string
}

export interface Reject {
  stepId: string
  row: Row
  errors: string[]
}

export interface EngineResult {
  status: 'success' | 'partial' | 'failed'
  steps: StepStat[]
  rejects: Reject[]
  rejectedCount: number
  rowsRead: number
  rowsWritten: number
  columns: OutputColumn[]
  error?: string
  /** false when retrying can't help (bad config, validation abort). */
  retryable?: boolean
  destination?: { kind: string; target: string; rowCount?: number }
  /** Incremental sync: highest watermark value read this run (null if no rows). */
  watermark?: { column: string; value: string | null }
}

export interface EngineIO {
  read(step: SourceStep): Promise<Row[]>
  /** Omitted for test runs. */
  write?(step: DestinationStep, rows: Row[], columns: OutputColumn[]): Promise<{ written: number; target: string; rowCount?: number }>
}

const MAX_REJECTS_KEPT = 500

export function stepLabel(step: PipelineStep): string {
  switch (step.type) {
    case 'source':
      return `Read ${step.table}`
    case 'filter':
      return `Filter (${step.conditions.length} condition${step.conditions.length === 1 ? '' : 's'})`
    case 'map':
      return `Map ${step.fields.length} field${step.fields.length === 1 ? '' : 's'}`
    case 'validate':
      return `Validate (${step.rules.length} rule${step.rules.length === 1 ? '' : 's'})`
    case 'destination':
      return step.kind === 'dataset' ? `Write dataset ${step.datasetName}` : `Write ${step.table}`
  }
}

/** Output columns: declared by the last Map step, otherwise inferred from data. */
export function outputColumns(def: PipelineDefinition, rows: Row[]): OutputColumn[] {
  const maps = def.steps.filter((s) => s.type === 'map')
  const lastMap = maps[maps.length - 1]
  if (lastMap?.type === 'map') {
    const declared: OutputColumn[] = lastMap.fields.map((f) => ({ name: f.to, type: f.type }))
    if (!lastMap.keepUnmapped) return declared
    const names = new Set(declared.map((c) => c.name))
    return [...declared, ...inferColumns(rows).filter((c) => !names.has(c.name))]
  }
  return inferColumns(rows)
}

export async function runEngine(def: PipelineDefinition, io: EngineIO, opts: { sampleSize?: number } = {}): Promise<EngineResult> {
  const testRun = !io.write
  const steps: StepStat[] = []
  const rejects: Reject[] = []
  let rejectedCount = 0
  let rows: Row[] = []
  let rowsRead = 0
  let rowsWritten = 0
  let columns: OutputColumn[] = []
  let destination: EngineResult['destination']
  let watermark: EngineResult['watermark']
  const sample = (r: Row[]) => (testRun ? r.slice(0, opts.sampleSize ?? 25) : undefined)

  for (const step of def.steps) {
    const started = Date.now()
    const stat: StepStat = { id: step.id, type: step.type, label: stepLabel(step), rowsIn: rows.length, rowsOut: 0, rejected: 0, durationMs: 0 }
    steps.push(stat)
    try {
      switch (step.type) {
        case 'source': {
          rows = await io.read(step)
          rowsRead = rows.length
          stat.rowsIn = 0
          if (step.mode === 'incremental') {
            if (rows.length && !(step.watermarkColumn in rows[0])) {
              throw Object.assign(new Error(`Watermark column "${step.watermarkColumn}" is not in ${step.table}.`), { retryable: false })
            }
            watermark = { column: step.watermarkColumn, value: maxWatermark(rows, step.watermarkColumn) }
          }
          break
        }
        case 'filter':
          rows = rows.filter((r) => matchesFilter(r, step))
          break
        case 'map': {
          const next: Row[] = []
          for (const r of rows) {
            const { row, errors } = applyMap(r, step)
            if (errors.length) {
              stat.rejected++
              rejectedCount++
              if (rejects.length < MAX_REJECTS_KEPT) rejects.push({ stepId: step.id, row: r, errors })
            } else next.push(row)
          }
          rows = next
          break
        }
        case 'validate': {
          const seen = new Map<string, Set<string>>()
          const next: Row[] = []
          for (const r of rows) {
            const errors = validateRow(r, step, seen)
            if (!errors.length) {
              next.push(r)
              continue
            }
            if (step.onFail === 'abort') throw Object.assign(new Error(`Validation failed: ${errors.join('; ')}`), { retryable: false })
            stat.rejected++
            rejectedCount++
            if (rejects.length < MAX_REJECTS_KEPT) rejects.push({ stepId: step.id, row: r, errors })
          }
          rows = next
          break
        }
        case 'destination': {
          columns = outputColumns(def, rows)
          if (!columns.length && rows.length) throw new Error('No output columns. Add a Map step or check the source.')
          const keyCols = new Set(columns.map((c) => c.name))
          const missingKeys = step.keys.filter((k) => !keyCols.has(k))
          if (step.mode === 'upsert' && missingKeys.length) {
            throw Object.assign(new Error(`Upsert key column(s) not in output: ${missingKeys.join(', ')}`), { retryable: false })
          }
          if (io.write) {
            const res = await io.write(step, rows, columns)
            rowsWritten = res.written
            destination = { kind: step.kind, target: res.target, rowCount: res.rowCount }
          }
          break
        }
      }
      stat.rowsOut = rows.length
      stat.sample = sample(rows)
    } catch (err) {
      stat.error = err instanceof Error ? err.message : String(err)
      stat.durationMs = Date.now() - started
      // Only I/O steps can fail transiently (network, locks, timeouts); transforms are deterministic.
      const retryable = (err as { retryable?: boolean }).retryable !== false && (step.type === 'source' || step.type === 'destination')
      return { status: 'failed', steps, rejects, rejectedCount, rowsRead, rowsWritten, columns, error: `${stat.label}: ${stat.error}`, retryable, destination }
    }
    stat.durationMs = Date.now() - started
  }

  return {
    status: rejectedCount > 0 ? 'partial' : 'success',
    steps,
    rejects,
    rejectedCount,
    rowsRead,
    rowsWritten,
    columns,
    destination,
    watermark,
  }
}

// ── Chunked runs (background worker, lib/pipelines/jobs.ts) ──────────────────
// A run reads the source in chunks and pushes each chunk through the transform
// steps here. Pure: all I/O (reads, writes, checkpoints) happens in jobs.ts.

/** Running totals of a chunked run, persisted between chunks. */
export interface RunTotals {
  steps: StepStat[]
  rowsRead: number
  rowsWritten: number
  rejectedCount: number
  columns: OutputColumn[]
  watermark?: { column: string; value: string | null }
}

export function newRunTotals(def: PipelineDefinition): RunTotals {
  return {
    steps: def.steps.map((s) => ({ id: s.id, type: s.type, label: stepLabel(s), rowsIn: 0, rowsOut: 0, rejected: 0, durationMs: 0 })),
    rowsRead: 0,
    rowsWritten: 0,
    rejectedCount: 0,
    columns: [],
  }
}

export interface ChunkOutput {
  /** Rows ready for the destination. */
  rows: Row[]
  rejects: Reject[]
}

/**
 * Runs the steps between source and destination on one chunk of source rows,
 * adding to `totals`. `seen` carries values of "unique" rules across chunks.
 * Throws (retryable: false) when a Validate step set to abort fails.
 */
export function transformChunk(def: PipelineDefinition, input: Row[], totals: RunTotals, seen: Map<string, Set<string>>): ChunkOutput {
  const rejects: Reject[] = []
  let rows = input
  def.steps.forEach((step, i) => {
    const stat = totals.steps[i]
    const started = Date.now()
    switch (step.type) {
      case 'source': {
        stat.rowsOut += rows.length
        totals.rowsRead += rows.length
        if (step.mode === 'incremental' && rows.length) {
          if (!(step.watermarkColumn in rows[0])) {
            throw Object.assign(new Error(`Watermark column "${step.watermarkColumn}" is not in ${step.table}.`), { retryable: false })
          }
          const chunkMax = maxWatermark(rows, step.watermarkColumn)
          const prev = totals.watermark?.value ?? null
          const value = prev === null ? chunkMax : chunkMax === null ? prev : compareWatermarks(chunkMax, prev) > 0 ? chunkMax : prev
          totals.watermark = { column: step.watermarkColumn, value }
        }
        break
      }
      case 'filter':
        stat.rowsIn += rows.length
        rows = rows.filter((r) => matchesFilter(r, step))
        stat.rowsOut += rows.length
        break
      case 'map': {
        stat.rowsIn += rows.length
        const next: Row[] = []
        for (const r of rows) {
          const { row, errors } = applyMap(r, step)
          if (errors.length) {
            stat.rejected++
            totals.rejectedCount++
            rejects.push({ stepId: step.id, row: r, errors })
          } else next.push(row)
        }
        rows = next
        stat.rowsOut += rows.length
        break
      }
      case 'validate': {
        stat.rowsIn += rows.length
        const next: Row[] = []
        for (const r of rows) {
          const errors = validateRow(r, step, seen)
          if (!errors.length) {
            next.push(r)
            continue
          }
          if (step.onFail === 'abort') throw Object.assign(new Error(`${stepLabel(step)}: Validation failed: ${errors.join('; ')}`), { retryable: false })
          stat.rejected++
          totals.rejectedCount++
          rejects.push({ stepId: step.id, row: r, errors })
        }
        rows = next
        stat.rowsOut += rows.length
        break
      }
      case 'destination':
        // Columns: declared by the last Map, else inferred; later chunks can add inferred columns.
        if (rows.length) {
          const known = new Set(totals.columns.map((c) => c.name))
          totals.columns = [...totals.columns, ...outputColumns(def, rows).filter((c) => !known.has(c.name))]
        }
        stat.rowsIn += rows.length
        break
    }
    stat.durationMs += Date.now() - started
  })
  return { rows, rejects }
}

/** Checks the destination can take this run's output; call before the first write. */
export function checkDestination(def: PipelineDefinition, columns: OutputColumn[]) {
  const dest = def.steps[def.steps.length - 1]
  if (dest.type !== 'destination') return
  if (!columns.length) throw new Error('No output columns. Add a Map step or check the source.')
  const names = new Set(columns.map((c) => c.name))
  const missingKeys = dest.keys.filter((k) => !names.has(k))
  if (dest.mode === 'upsert' && missingKeys.length) {
    throw Object.assign(new Error(`Upsert key column(s) not in output: ${missingKeys.join(', ')}`), { retryable: false })
  }
}

/** Final status of a finished chunked run. */
export function totalsStatus(totals: RunTotals): 'success' | 'partial' {
  return totals.rejectedCount > 0 ? 'partial' : 'success'
}
