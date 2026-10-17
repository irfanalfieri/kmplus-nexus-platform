'use client'

import { useId, useMemo, useState } from 'react'
import { columnLabel, type Widget, type WidgetResult } from '@/lib/analytics/definition'
import { isTimeSeries } from '@/lib/analytics/query'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { LOCALE_INFO } from '@/lib/i18n/config'
import type { MessageKey, Translate } from '@/lib/i18n/translate'

/**
 * Analytics widget renderers (data-viz rules):
 * - Series colours come only from the chart tokens `var(--chart-1)` … `var(--chart-5)`,
 *   in that fixed order (defined for light and dark in globals.css). Never hard-coded,
 *   and status colours (live / danger / warning / held) are never series colours.
 * - Single-series charts use slot 1 (blue).
 * - Axes and grid lines use `var(--border)`; labels `var(--muted-foreground)`; values
 *   use text tokens, never the series colour.
 * - Every chart has a table view, so no value is hover-only.
 */

/** Series colours in slot order. Index 0 is slot 1. */
export const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'] as const
const SERIES = SERIES_COLORS[0]
const fmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
export const formatValue = (v: number | null) => (v === null ? '—' : fmt.format(v))

/** `describeMeasure` in the interface language ("Rows", "Average of salary"). */
export function describeMeasureT(w: Pick<Widget, 'measure'> & { join?: Widget['join'] }, t: Translate) {
  return w.measure.agg === 'count'
    ? t('insights.charts.rowsMeasure')
    : t('insights.charts.measureOf', { agg: t(`insights.widgetEditor.aggs.${w.measure.agg}` as MessageKey), column: columnLabel(w.measure.column, w.join) })
}

/** `defaultTitle` in the interface language ("Rows by department (month)"). */
export function defaultTitleT(w: Pick<Widget, 'measure' | 'dimension' | 'dataset'> & { join?: Widget['join'] }, t: Translate) {
  const measure = describeMeasureT(w, t)
  if (!w.dimension) return t('insights.charts.ofDataset', { measure, dataset: w.join ? `${w.dataset} + ${w.join.dataset}` : w.dataset })
  const column = columnLabel(w.dimension.column, w.join)
  return w.dimension.grain !== 'none'
    ? t('insights.charts.byGrain', { measure, column, grain: t(`insights.widgetEditor.grains.${w.dimension.grain}` as MessageKey) })
    : t('insights.charts.by', { measure, column })
}

/** `freshness()` from lib/catalog/definition in the interface language ("12 min ago"). */
export function freshnessT(at: Date | string | null | undefined, t: Translate, now = Date.now()): string {
  if (!at) return t('insights.time.neverLoaded')
  const ms = now - new Date(at).getTime()
  if (ms < 60_000) return t('insights.time.justNow')
  const min = Math.floor(ms / 60_000)
  if (min < 60) return t('insights.time.minutesAgo', { count: min })
  const h = Math.floor(min / 60)
  if (h < 48) return t('insights.time.hoursAgo', { count: h })
  return t('insights.time.daysAgo', { count: Math.floor(h / 24) })
}

/** Number formatting and empty labels that follow the interface language. */
function useChartText() {
  const { t, locale } = usePrefs()
  return useMemo(() => {
    const intl = LOCALE_INFO[locale].intl
    const num = new Intl.NumberFormat(intl, { maximumFractionDigits: 2 })
    const short = new Intl.NumberFormat(intl, { notation: 'compact', maximumFractionDigits: 1 })
    return {
      t,
      num,
      short,
      value: (v: number | null) => (v === null ? '—' : num.format(v)),
      label: (l: string | null) => (l === null || l === '' ? t('insights.charts.empty') : l),
      measure: (w: Pick<Widget, 'measure'>) => describeMeasureT(w, t),
    }
  }, [t, locale])
}

export function WidgetView({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const [table, setTable] = useState(false)
  const { t } = usePrefs()
  if (widget.type === 'kpi') return <Kpi widget={widget} value={result.rows[0]?.value ?? null} />
  if (!result.rows.length) return <p className="py-8 text-center text-sm text-muted-foreground">{t('insights.charts.noRows')}</p>
  return (
    <div className="space-y-2">
      {widget.type === 'table' || table ? <ResultTable widget={widget} result={result} /> : widget.type === 'line' ? <Line widget={widget} result={result} /> : <Bars widget={widget} result={result} />}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">
          {result.truncated
            ? isTimeSeries(widget) ? t('insights.charts.latestPeriods', { count: widget.limit }) : t('insights.charts.topGroups', { count: widget.limit })
            : t(isTimeSeries(widget) ? 'insights.charts.periods' : 'insights.charts.groups', { count: result.rows.length })}
        </span>
        {widget.type !== 'table' && (
          <button
            type="button"
            aria-pressed={table}
            className="rounded-sm font-medium text-info-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => setTable((t) => !t)}
          >
            {table ? t('insights.charts.showChart') : t('insights.charts.showTable')}
          </button>
        )}
      </div>
    </div>
  )
}

function Kpi({ widget, value }: { widget: Widget; value: number | null }) {
  const { num: fmt, short: compact, measure: describeMeasure } = useChartText()
  const big = value !== null && Math.abs(value) >= 1_000_000
  return (
    <div className="py-4">
      <div className="font-mono text-4xl font-semibold tracking-tight tabular-nums" title={value === null ? undefined : fmt.format(value)}>
        {value === null ? '—' : big ? compact.format(value) : fmt.format(value)}
      </div>
      <div className="mt-1 text-sm text-muted-foreground">{describeMeasure(widget)}</div>
    </div>
  )
}

/** Horizontal bars: long category labels stay readable; value at each bar's end. */
function Bars({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const { value: formatValue, label: labelOf, measure: describeMeasure } = useChartText()
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
              <span className="h-5 shrink-0 rounded-r-[4px]" style={{ width: `calc(${pct}% * 0.82)`, minWidth: pct > 0 ? 2 : 0, background: SERIES }} aria-hidden />
              <span className="shrink-0 font-mono text-xs tabular-nums">{formatValue(r.value)}</span>
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
  const { t, value: formatValue, label: labelOf, measure: describeMeasure } = useChartText()
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
        <title id={`${id}-t`}>{t('insights.charts.by', { measure: describeMeasure(widget), column: widget.dimension?.column ?? '' })}</title>
        {grid.map((y) => (
          <line key={y} x1={pad.l} x2={W - pad.r} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} />
        ))}
        <polyline points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {pts.length === 1 && <circle cx={pts[0].x} cy={pts[0].y} r={4} fill={SERIES} />}
        {last && (
          <text x={last.x} y={last.y - 8} textAnchor="end" fill="var(--foreground)" className="font-mono text-[12px] tabular-nums">
            {formatValue(last.value)}
          </text>
        )}
        {[pts[0], pts[Math.floor((pts.length - 1) / 2)], last].filter((p, i, a) => p && a.indexOf(p) === i).map((p) => (
          <text key={`x-${p!.x}`} x={p!.x} y={H - 8} textAnchor={p === pts[0] ? 'start' : p === last ? 'end' : 'middle'} fill="var(--muted-foreground)" className="font-mono text-[11px]">
            {labelOf(p!.label)}
          </text>
        ))}
        {active && (
          <>
            <line x1={active.x} x2={active.x} y1={pad.t} y2={H - pad.b} stroke="var(--muted-foreground)" strokeWidth={1} strokeDasharray="3 3" />
            <circle cx={active.x} cy={active.y} r={5} fill={SERIES} stroke="var(--background)" strokeWidth={2} />
          </>
        )}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute top-0 rounded-md border border-border bg-popover px-2 py-1 text-xs shadow-raised"
          style={{ left: `${(active.x / W) * 100}%`, transform: active.x > W * 0.7 ? 'translateX(-105%)' : 'translateX(8px)' }}
          role="status"
        >
          <div className="font-mono font-semibold tabular-nums">{formatValue(active.value)}</div>
          <div className="text-muted-foreground">{labelOf(active.label)}</div>
        </div>
      )}
    </div>
  )
}

function ResultTable({ widget, result }: { widget: Widget; result: WidgetResult }) {
  const { t, value: formatValue, label: labelOf, measure: describeMeasure } = useChartText()
  return (
    <div className="max-h-72 overflow-auto rounded-md border border-border">
      <Table label={describeMeasure(widget)}>
        <THead className="sticky top-0 bg-muted">
          <tr>
            <Th>
              {widget.dimension?.column ?? ''}
              {widget.dimension && widget.dimension.grain !== 'none' ? ` (${t(`insights.widgetEditor.grains.${widget.dimension.grain}` as MessageKey)})` : ''}
            </Th>
            <Th className="text-right">{describeMeasure(widget)}</Th>
          </tr>
        </THead>
        <TBody>
          {result.rows.map((r, i) => (
            <Tr key={`${r.label}-${i}`}>
              <Td className="py-1.5">{labelOf(r.label)}</Td>
              <Td className="py-1.5 text-right font-mono text-xs tabular-nums">{formatValue(r.value)}</Td>
            </Tr>
          ))}
        </TBody>
      </Table>
    </div>
  )
}

/** Small swatch for the legend-free single series (used in the editor). */
export function SeriesSwatch() {
  return <span className="inline-block h-2 w-3 rounded-sm" style={{ background: SERIES }} aria-hidden />
}
