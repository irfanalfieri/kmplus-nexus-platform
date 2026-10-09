'use client'

import { useId, useMemo, useState } from 'react'
import type { Widget, WidgetResult } from '@/lib/analytics/definition'
import { describeMeasure } from '@/lib/analytics/definition'
import { isTimeSeries } from '@/lib/analytics/query'

/**
 * Analytics widget renderers. Single-series charts in the data-viz palette's
 * slot-1 blue (light #2a78d6 / dark #3987e5); text uses text tokens, never the
 * series color. Every chart has a table view, so no value is hover-only.
 */

const SERIES = 'bg-[#2a78d6] dark:bg-[#3987e5]'
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
export const formatValue = (v: number | null) => (v === null ? '—' : fmt.format(v))
const labelOf = (l: string | null) => (l === null || l === '' ? '(empty)' : l)

export function WidgetView({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const [table, setTable] = useState(false)
  if (widget.type === 'kpi') return <Kpi widget={widget} value={result.rows[0]?.value ?? null} />
  if (!result.rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">No rows match.</p>
  return (
    <div className="space-y-2">
      {widget.type === 'table' || table ? <ResultTable widget={widget} result={result} /> : widget.type === 'line' ? <Line widget={widget} result={result} /> : <Bars widget={widget} result={result} />}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          {result.truncated
            ? isTimeSeries(widget) ? `Latest ${widget.limit} periods shown` : `Top ${widget.limit} groups shown`
            : `${result.rows.length} ${isTimeSeries(widget) ? 'period' : 'group'}${result.rows.length === 1 ? '' : 's'}`}
        </span>
        {widget.type !== 'table' && (
          <button className="underline-offset-4 hover:underline" onClick={() => setTable((t) => !t)}>
            {table ? 'Show chart' : 'Show table'}
          </button>
        )}
      </div>
    </div>
  )
}

function Kpi({ widget, value }: { widget: Widget; value: number | null }) {
  const big = value !== null && Math.abs(value) >= 1_000_000
  return (
    <div className="py-4">
      <div className="text-4xl font-semibold tabular-nums tracking-tight" title={value === null ? undefined : fmt.format(value)}>
        {value === null ? '—' : big ? compact.format(value) : fmt.format(value)}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{describeMeasure(widget)}</div>
    </div>
  )
}

/** Horizontal bars: long category labels stay readable; value at each bar's end. */
function Bars({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const max = Math.max(0, ...result.rows.map((r) => r.value ?? 0))
  return (
    <ul className="space-y-1.5" aria-label={describeMeasure(widget)}>
      {result.rows.map((r, i) => {
        const pct = max > 0 && r.value !== null && r.value > 0 ? (r.value / max) * 100 : 0
        return (
          <li key={`${r.label}-${i}`} className="grid grid-cols-[minmax(0,34%)_1fr] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground" title={labelOf(r.label)}>{labelOf(r.label)}</span>
            <span className="flex min-w-0 items-center gap-2">
              {/* ≤24px thick, 4px rounded data end, square at the baseline */}
              <span className={`h-5 shrink-0 rounded-r-[4px] ${SERIES}`} style={{ width: `calc(${pct}% * 0.82)`, minWidth: pct > 0 ? 2 : 0 }} aria-hidden />
              <span className="shrink-0 tabular-nums">{formatValue(r.value)}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/** Line over time with a crosshair tooltip; endpoint labelled. */
function Line({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const id = useId()
  const [hover, setHover] = useState<number | null>(null)
  const W = 600
  const H = 220
  const pad = { l: 8, r: 8, t: 16, b: 28 }
  const pts = useMemo(() => {
    const values = result.rows.map((r) => r.value ?? 0)
    const max = Math.max(...values, 0)
    const min = Math.min(...values, 0)
    const span = max - min || 1
    const n = result.rows.length
    return result.rows.map((r, i) => ({
      x: pad.l + (n === 1 ? (W - pad.l - pad.r) / 2 : (i / (n - 1)) * (W - pad.l - pad.r)),
      y: pad.t + (1 - ((r.value ?? 0) - min) / span) * (H - pad.t - pad.b),
      ...r,
    }))
  }, [result.rows, pad.l, pad.r, pad.t, pad.b])
  const grid = [0, 0.5, 1].map((f) => pad.t + f * (H - pad.t - pad.b))
  const last = pts[pts.length - 1]
  const active = hover !== null ? pts[hover] : null
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    let best = 0
    pts.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(pts[best].x - x)) best = i
    })
    setHover(best)
  }
  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-56 w-full overflow-visible"
        role="img"
        aria-labelledby={`${id}-t`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        <title id={`${id}-t`}>{`${describeMeasure(widget)} by ${widget.dimension?.column}`}</title>
        {grid.map((y) => (
          <line key={y} x1={pad.l} x2={W - pad.r} y1={y} y2={y} className="stroke-border" strokeWidth={1} />
        ))}
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" className="stroke-[#2a78d6] dark:stroke-[#3987e5]" />
        {pts.length === 1 && <circle cx={pts[0].x} cy={pts[0].y} r={4} className="fill-[#2a78d6] dark:fill-[#3987e5]" />}
        {last && (
          <text x={last.x} y={last.y - 8} textAnchor="end" className="fill-foreground text-[12px] tabular-nums">
            {formatValue(last.value)}
          </text>
        )}
        {[pts[0], pts[Math.floor((pts.length - 1) / 2)], last].filter((p, i, a) => p && a.indexOf(p) === i).map((p) => (
          <text key={`x-${p!.x}`} x={p!.x} y={H - 8} textAnchor={p === pts[0] ? 'start' : p === last ? 'end' : 'middle'} className="fill-muted-foreground text-[11px]">
            {labelOf(p!.label)}
          </text>
        ))}
        {active && (
          <>
            <line x1={active.x} x2={active.x} y1={pad.t} y2={H - pad.b} className="stroke-muted-foreground" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={active.x} cy={active.y} r={5} className="fill-[#2a78d6] stroke-background dark:fill-[#3987e5]" strokeWidth={2} />
          </>
        )}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-sm"
          style={{ left: `${(active.x / W) * 100}%`, transform: active.x > W * 0.7 ? 'translateX(-105%)' : 'translateX(8px)' }}
          role="status"
        >
          <div className="font-semibold tabular-nums">{formatValue(active.value)}</div>
          <div className="text-muted-foreground">{labelOf(active.label)}</div>
        </div>
      )}
    </div>
  )
}

function ResultTable({ widget, result }: { widget: Widget; result: WidgetResult }) {
  return (
    <div className="max-h-72 overflow-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-card">
          <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
            <th className="px-2 py-1.5">{widget.dimension?.column ?? ''}{widget.dimension && widget.dimension.grain !== 'none' ? ` (${widget.dimension.grain})` : ''}</th>
            <th className="px-2 py-1.5 text-right">{describeMeasure(widget)}</th>
          </tr>
        </thead>
        <tbody>
          {result.rows.map((r, i) => (
            <tr key={`${r.label}-${i}`} className="border-b border-border/60">
              <td className="px-2 py-1.5">{labelOf(r.label)}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{formatValue(r.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** Small swatch for the legend-free single series (used in the editor). */
export function SeriesSwatch() {
  return <span className={`inline-block h-2 w-3 rounded-sm ${SERIES}`} aria-hidden />
}
