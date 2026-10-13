'use client'

import { Fragment, useEffect, useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import { getQualityHistory } from '@/lib/actions/catalog'
import { WidgetView } from '@/components/analytics/charts'
import { widgetSchema } from '@/lib/analytics/definition'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useT } from '@/components/i18n/i18n-provider'

type History = Awaited<ReturnType<typeof getQualityHistory>>

/** Dimensions in display order; labels and help text live in `insights.qualityHistory.dimensions`. */
const DIMENSIONS = ['score', 'completeness', 'uniqueness', 'validity'] as const

/** Quality score per day for the last 30 days, and the latest dimensions (DQ-4). */
export function QualityHistory({ datasetName }: { datasetName: string }) {
  const t = useT()
  const [data, setData] = useState<History | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError('')
    getQualityHistory(datasetName)
      .then((h) => !cancelled && setData(h))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t('insights.qualityHistory.loadFailed')))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [datasetName])

  if (error) return <Notice tone="danger">{error}</Notice>
  if (!data)
    return (
      <p className="flex items-center text-sm text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('insights.qualityHistory.loading')}
      </p>
    )
  const latest = data.days[data.days.length - 1]
  if (!latest)
    return (
      <EmptyState compact icon={<Gauge />} title={t('insights.qualityHistory.emptyTitle')}>
        {t('insights.qualityHistory.emptyBody')}
      </EmptyState>
    )

  const widget = widgetSchema.parse({ id: 'quality', title: t('insights.qualityHistory.widgetTitle'), type: 'line', dataset: datasetName, measure: { agg: 'avg', column: 'score' }, dimension: { column: 'day', grain: 'day' }, limit: 31 })
  const series = { rows: data.days.filter((d) => d.score !== null).map((d) => ({ label: d.day, value: d.score })), truncated: false }

  return (
    <div className="space-y-3">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {DIMENSIONS.map((k) => (
          <div key={k} className="rounded-md border border-border p-2" title={t(`insights.qualityHistory.dimensions.${k}.help`)}>
            <dt className="text-[11px] text-muted-foreground">{t(`insights.qualityHistory.dimensions.${k}.label`)}</dt>
            <dd className="font-mono text-lg font-semibold tabular-nums">{latest[k] === null ? '—' : `${latest[k]}%`}</dd>
          </div>
        ))}
        <div className="rounded-md border border-border p-2" title={t('insights.qualityHistory.freshnessHelp')}>
          <dt className="text-[11px] text-muted-foreground">{t('insights.qualityHistory.freshness')}</dt>
          <dd className="font-mono text-lg font-semibold tabular-nums">
            {data.freshnessHours === null ? '—' : data.freshnessHours < 1 ? t('insights.qualityHistory.lessThanHour') : t('insights.qualityHistory.hours', { count: data.freshnessHours })}
          </dd>
        </div>
      </dl>
      {series.rows.length > 1 ? (
        <WidgetView widget={widget} result={series} />
      ) : (
        <p className="text-xs text-muted-foreground">
          {t('insights.qualityHistory.oneMeasurement').split('{day}').map((part, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="font-mono">{latest.day}</span>}
              {part}
            </Fragment>
          ))}
        </p>
      )}
    </div>
  )
}
