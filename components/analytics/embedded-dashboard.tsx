'use client'

import { cn } from '@/lib/utils'
import { Notice } from '@/components/ui/notice'
import { KmLogo } from '@/components/brand/km-logo'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { Widget } from '@/lib/analytics/definition'
import type { WidgetOutcome } from '@/lib/analytics/dashboards'
import { WidgetView, freshnessT } from './charts'

/** DB-5: a dashboard shown read-only inside another app (no navigation, no editing). */
export function EmbeddedDashboard({ name, description, widgets, results, generatedAt }: { name: string; description: string; widgets: Widget[]; results: Record<string, WidgetOutcome>; generatedAt: string }) {
  const { t, formatDateTime } = usePrefs()
  return (
    <main className="min-h-screen bg-background p-4 text-foreground">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold">{name}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <p className="text-xs text-muted-foreground">{t('insights.embed.asOf', { when: formatDateTime(generatedAt, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
      </header>
      {widgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('insights.embed.empty')}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {widgets.map((w) => {
            const r = results[w.id]
            return (
              <article key={w.id} className={cn('min-w-0 rounded-lg border border-border bg-card p-4', w.size === 'wide' && 'md:col-span-2')}>
                <h2 className="truncate font-medium">{w.title}</h2>
                {r?.ok && r.result.lastLoadedAt ? <p className="mb-2 truncate text-xs text-muted-foreground">{t('insights.analytics.loaded', { when: freshnessT(r.result.lastLoadedAt, t) })}</p> : <div className="mb-2" />}
                {!r ? null : r.ok ? <WidgetView widget={w} result={r.result} /> : <Notice tone="danger">{r.message}</Notice>}
              </article>
            )
          })}
        </div>
      )}
      <footer className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
        <KmLogo className="h-4 w-auto" alt="" /> {t('insights.embed.poweredBy')}
      </footer>
    </main>
  )
}
