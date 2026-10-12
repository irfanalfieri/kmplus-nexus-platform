'use client'

import { useEffect, useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import { getQualityHistory } from '@/lib/actions/catalog'
import { WidgetView } from '@/components/analytics/charts'
import { widgetSchema } from '@/lib/analytics/definition'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'

type History = Awaited<ReturnType<typeof getQualityHistory>>

const DIMENSIONS = [
  ['score', 'Quality score', 'Average of the measured dimensions'],
  ['completeness', 'Completeness', 'Share of filled-in cells'],
  ['uniqueness', 'Uniqueness', 'Distinct keys per row'],
  ['validity', 'Validity', "Share of the latest run's rows that passed every check"],
] as const

/** Quality score per day for the last 30 days, and the latest dimensions (DQ-4). */
export function QualityHistory({ datasetName }: { datasetName: string }) {
  const [data, setData] = useState<History | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError('')
    getQualityHistory(datasetName)
      .then((h) => !cancelled && setData(h))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load quality history'))
    return () => {
      cancelled = true
    }
  }, [datasetName])

  if (error) return <Notice tone="danger">{error}</Notice>
  if (!data)
    return (
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading quality…
      </p>
    )
  const latest = data.days[data.days.length - 1]
  if (!latest)
    return (
      <EmptyState compact icon={<Gauge />} title="No measurements yet">
        Quality is measured after each pipeline run that writes this dataset.
      </EmptyState>
    )

  const widget = widgetSchema.parse({ id: 'quality', title: 'Quality score', type: 'line', dataset: datasetName, measure: { agg: 'avg', column: 'score' }, dimension: { column: 'day', grain: 'day' }, limit: 31 })
  const series = { rows: data.days.filter((d) => d.score !== null).map((d) => ({ label: d.day, value: d.score })), truncated: false }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DIMENSIONS.map(([k, label, help]) => (
          <div key={k} className="rounded-md border border-border p-2" title={help}>
            <dt className="text-[11px] text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">{latest[k] === null ? '—' : `${latest[k]}%`}</dd>
          </div>
        ))}
        <div className="rounded-md border border-border p-2" title="Hours since the dataset was last loaded">
          <dt className="text-[11px] text-muted-foreground">Freshness</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">{data.freshnessHours === null ? '—' : data.freshnessHours < 1 ? '< 1 h' : `${data.freshnessHours} h`}</dd>
        </div>
      </dl>
      {series.rows.length > 1 ? (
        <WidgetView widget={widget} result={series} />
      ) : (
        <p className="text-xs text-muted-foreground">
          One measurement so far (<span className="font-mono">{latest.day}</span>); the trend appears after runs on more days.
        </p>
      )}
    </div>
  )
}
