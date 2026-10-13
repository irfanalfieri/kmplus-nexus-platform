'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Database, LayoutDashboard, Loader2, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import { deleteDashboard, getAnalyticsDatasets, getDashboardData, listDashboards, saveDashboard } from '@/lib/actions/analytics'
import type { Widget } from '@/lib/analytics/definition'
import { WidgetView, freshnessT } from '@/components/analytics/charts'
import WidgetEditor, { newWidget } from '@/components/analytics/widget-editor'
import { AiAsk } from '@/components/ai/ai-ask'

type List = Awaited<ReturnType<typeof listDashboards>>
type Dash = List['dashboards'][number]
type Datasets = Awaited<ReturnType<typeof getAnalyticsDatasets>>
type Results = Awaited<ReturnType<typeof getDashboardData>>['results']

export default function AnalyticsDashboardLayer() {
  const { t, formatDateTime } = usePrefs()
  const when = (d: Date | string) =>
    t('insights.time.wib', { time: formatDateTime(d, { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) })
  const [confirm, confirmEl] = useConfirm()
  const [list, setList] = useState<List | null>(null)
  const [datasets, setDatasets] = useState<Datasets>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [editing, setEditing] = useState<Widget | null>(null)
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ name: string; description: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [l, d] = await Promise.all([listDashboards(), getAnalyticsDatasets()])
      setList(l)
      setDatasets(d)
      setSelectedId((cur) => (cur && l.dashboards.some((x) => x.id === cur) ? cur : l.dashboards[0]?.id ?? null))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.analytics.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const dash = list?.dashboards.find((d) => d.id === selectedId) ?? null

  const loadData = useCallback(async (id: string) => {
    setLoadingData(true)
    try {
      setResults((await getDashboardData(id)).results)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.analytics.dataFailed'))
    } finally {
      setLoadingData(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setResults(null)
    setRename(null)
    if (dash && list?.canView && dash.widgets.length) void loadData(dash.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash?.id, list?.canView])

  const persist = async (d: Dash, widgets: Widget[], meta?: { name: string; description: string }) => {
    await saveDashboard({ id: d.id, name: meta?.name ?? d.name, description: meta?.description ?? d.description, widgets })
    await load()
    if (widgets.length && list?.canView) await loadData(d.id)
  }

  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { id } = await saveDashboard({ name: newName, description: '', widgets: [] })
      setNewName('')
      await load()
      setSelectedId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.analytics.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError('')
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  const move = (i: number, dir: -1 | 1) => {
    if (!dash) return
    const w = [...dash.widgets]
    const j = i + dir
    if (j < 0 || j >= w.length) return
    ;[w[i], w[j]] = [w[j], w[i]]
    void act(() => persist(dash, w))
  }

  const removeDashboard = async (d: Dash) => {
    const ok = await confirm({
      title: t('insights.analytics.deleteTitle', { name: d.name }),
      description: t('insights.analytics.deleteBody', { count: d.widgets.length }),
      confirmLabel: t('insights.analytics.deleteDashboard'),
      tone: 'danger',
    })
    if (!ok) return
    await act(async () => {
      await deleteDashboard(d.id)
      setSelectedId(null)
      await load()
    })
  }

  const removeWidget = async (d: Dash, w: Widget) => {
    const ok = await confirm({
      title: t('insights.analytics.removeWidgetTitle', { name: w.title }),
      description: t('insights.analytics.removeWidgetBody', { dashboard: d.name }),
      confirmLabel: t('insights.analytics.removeWidget'),
      tone: 'danger',
    })
    if (ok) await act(() => persist(d, d.widgets.filter((x) => x.id !== w.id)))
  }

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.analytics.title')} description={t('pages.analytics.description')} />
      {confirmEl}
      {editing && dash && (
        <WidgetEditor
          datasets={datasets}
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (w) => {
            const exists = dash.widgets.some((x) => x.id === w.id)
            await persist(dash, exists ? dash.widgets.map((x) => (x.id === w.id ? w : x)) : [...dash.widgets, w])
            setEditing(null)
          }}
        />
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      {list?.canView && datasets.length > 0 && <AiAsk datasets={datasets.map((d) => d.name)} onAdd={list.canEdit && dash ? (w) => persist(dash, [...dash.widgets, w]) : undefined} />}

      {!list ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('insights.analytics.loading')}
          </div>
        )
      ) : !list.canView ? (
        <Notice tone="info" live={false}>
          {t('insights.analytics.noAccess')}
        </Notice>
      ) : datasets.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState
            icon={<Database />}
            title={t('insights.analytics.noDatasetsTitle')}
            action={
              <Link href="/dashboard/pipelines" className={buttonVariants()}>
                {t('insights.analytics.goPipelines')}
              </Link>
            }
          >
            {t('insights.analytics.noDatasetsBody')}
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            <ul className="space-y-1" aria-label={t('insights.analytics.dashboardsLabel')}>
              {list.dashboards.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setSelectedId(d.id)}
                    aria-current={d.id === selectedId ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      d.id === selectedId ? 'bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)]' : 'hover:bg-muted'
                    )}
                  >
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="font-mono text-xs text-muted-foreground">{t('insights.analytics.widgets', { count: d.widgets.length })}</div>
                  </button>
                </li>
              ))}
              {list.dashboards.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">{t('insights.analytics.noDashboards')}</li>}
            </ul>
            {list.canEdit && (
              <form onSubmit={create} className="space-y-2 rounded-lg border border-border bg-card p-3">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('insights.analytics.newName')} aria-label={t('insights.analytics.newName')} required />
                <Button type="submit" size="sm" className="w-full" disabled={busy || !newName.trim()}>
                  <Plus className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.create')}
                </Button>
              </form>
            )}
          </aside>

          {!dash ? (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState icon={<LayoutDashboard />} title={t('insights.analytics.noneSelectedTitle')}>
                {list.canEdit ? t('insights.analytics.noneSelectedCreate') : t('insights.analytics.noneSelectedEmpty')}
              </EmptyState>
            </div>
          ) : (
            <section className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-border bg-card p-4">
                {rename ? (
                  <form
                    className="flex flex-1 flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault()
                      void act(async () => {
                        await persist(dash, dash.widgets, rename)
                        setRename(null)
                      })
                    }}
                  >
                    <Input value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} className="max-w-xs" aria-label={t('insights.analytics.nameLabel')} required />
                    <Input value={rename.description} onChange={(e) => setRename({ ...rename, description: e.target.value })} placeholder={t('insights.analytics.descriptionPlaceholder')} className="max-w-md" aria-label={t('insights.analytics.descriptionLabel')} />
                    <Button type="submit" size="sm" disabled={busy}><Save className="mr-1 h-4 w-4" aria-hidden /> {t('common.save')}</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRename(null)}>{t('common.cancel')}</Button>
                  </form>
                ) : (
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold">{dash.name}</h2>
                    <p className="text-xs text-muted-foreground">
                      {dash.description ? `${dash.description} · ` : ''}
                      {t('insights.analytics.updated').split('{when}').map((part, i) => (
                        <Fragment key={i}>
                          {i > 0 && <span className="font-mono">{when(dash.updatedAt)}</span>}
                          {part}
                        </Fragment>
                      ))}
                    </p>
                  </div>
                )}
                {!rename && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadData(dash.id)} disabled={loadingData || !dash.widgets.length}>
                      <RefreshCw className={cn('mr-1 h-4 w-4', loadingData && 'animate-spin')} aria-hidden /> {t('common.refresh')}
                    </Button>
                    {list.canEdit && (
                      <>
                        <Button size="sm" onClick={() => setEditing(newWidget(datasets[0].name))} disabled={dash.widgets.length >= 24}>
                          <Plus className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.addWidget')}
                        </Button>
                        <Button size="icon-sm" variant="ghost" onClick={() => setRename({ name: dash.name, description: dash.description })} aria-label={t('insights.analytics.rename')} title={t('insights.analytics.rename')}>
                          <Pencil className="h-4 w-4" aria-hidden />
                        </Button>
                        <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void removeDashboard(dash)} aria-label={t('insights.analytics.deleteDashboard')} title={t('insights.analytics.deleteDashboard')}>
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {dash.widgets.length === 0 ? (
                <div className="rounded-lg border border-border bg-card">
                  <EmptyState
                    icon={<BarChart3 />}
                    title={t('insights.analytics.noWidgetsTitle')}
                    action={
                      list.canEdit ? (
                        <Button onClick={() => setEditing(newWidget(datasets[0].name))}>
                          <Plus className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.addWidget')}
                        </Button>
                      ) : undefined
                    }
                  >
                    {list.canEdit ? t('insights.analytics.noWidgetsEdit') : t('insights.analytics.noWidgetsView')}
                  </EmptyState>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {dash.widgets.map((w, i) => {
                    const r = results?.[w.id]
                    return (
                      <article key={w.id} className={cn('min-w-0 rounded-lg border border-border bg-card p-4', w.size === 'wide' && 'md:col-span-2')}>
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="truncate font-medium">{w.title}</h3>
                            <p className="truncate text-xs text-muted-foreground">
                              <span className="font-mono">{w.dataset}</span>
                              {w.filters.length ? ` · ${t('insights.analytics.filters', { count: w.filters.length })}` : ''}
                              {r?.ok && r.result.lastLoadedAt ? ` · ${t('insights.analytics.loaded', { when: freshnessT(r.result.lastLoadedAt, t) })}` : ''}
                            </p>
                          </div>
                          {list.canEdit && (
                            <div className="flex shrink-0">
                              <Button size="icon-sm" variant="ghost" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={t('insights.analytics.moveUp', { name: w.title })}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                              <Button size="icon-sm" variant="ghost" onClick={() => move(i, 1)} disabled={busy || i === dash.widgets.length - 1} aria-label={t('insights.analytics.moveDown', { name: w.title })}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                              <Button size="icon-sm" variant="ghost" onClick={() => setEditing(w)} aria-label={t('insights.analytics.editWidget', { name: w.title })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                              <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void removeWidget(dash, w)} aria-label={t('insights.analytics.removeWidgetLabel', { name: w.title })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                            </div>
                          )}
                        </div>
                        {!r ? (
                          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('common.loading')}</div>
                        ) : r.ok ? (
                          <WidgetView widget={w} result={r.result} />
                        ) : (
                          <Notice tone="danger">{r.message}</Notice>
                        )}
                      </article>
                    )
                  })}
                </div>
              )}
            </section>
          )}
        </div>
      )}
    </div>
  )
}
