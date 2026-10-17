'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Code2, Database, FileDown, ImageDown, LayoutDashboard, Loader2, Lock, Pencil, Plus, RefreshCw, Save, Share2, Trash2 } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { PageHeader } from '@/components/dashboard/page-header'
import { useHashTarget, useUrlIntents } from '@/components/dashboard/url-intents'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import { deleteDashboard, getAnalyticsDatasets, getDashboardData, getDashboardFilterOptions, listDashboards, saveDashboard } from '@/lib/actions/analytics'
import { DashboardFilterBar, DashboardFiltersEditor } from '@/components/analytics/dashboard-filters'
import type { DashboardFilter, DashboardFilterValues } from '@/lib/analytics/definition'
import type { Widget } from '@/lib/analytics/definition'
import { WidgetView, freshnessT } from '@/components/analytics/charts'
import WidgetEditor, { newWidget } from '@/components/analytics/widget-editor'
import { AiAsk } from '@/components/ai/ai-ask'
import { EmbedDashboardDialog, ShareDashboardDialog } from '@/components/analytics/dashboard-sharing'
import { downloadWidgetPng } from '@/lib/analytics/png'

type List = Awaited<ReturnType<typeof listDashboards>>
type Dash = List['dashboards'][number]
type Datasets = Awaited<ReturnType<typeof getAnalyticsDatasets>>
type Results = Awaited<ReturnType<typeof getDashboardData>>['results']

/** The viewer's filter choices as `?f.<id>=…` for the print view (DB-5). */
function printQuery(values: DashboardFilterValues) {
  const q = new URLSearchParams()
  for (const [id, v] of Object.entries(values)) {
    if (v.value) q.set(`f.${id}`, v.value)
    else if (v.preset === 'custom') {
      if (v.from) q.set(`f.${id}.from`, v.from)
      if (v.to) q.set(`f.${id}.to`, v.to)
    } else if (v.preset && v.preset !== 'all') q.set(`f.${id}`, v.preset)
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

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
  // DB-4: this view's filter choices and each value filter's options.
  const [filterValues, setFilterValues] = useState<DashboardFilterValues>({})
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({})
  const [editingFilters, setEditingFilters] = useState(false)
  // DB-5: sharing and embedding dialogs.
  const [sharing, setSharing] = useState(false)
  const [embedding, setEmbedding] = useState(false)

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

  const loadData = useCallback(async (id: string, values: DashboardFilterValues = {}) => {
    setLoadingData(true)
    try {
      setResults((await getDashboardData(id, values)).results)
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
    setFilterValues({})
    setFilterOptions({})
    if (dash && list?.canView && dash.widgets.length) void loadData(dash.id)
    if (dash && list?.canView && dash.filters.some((f) => f.kind === 'value')) void getDashboardFilterOptions(dash.id).then(setFilterOptions).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dash?.id, list?.canView])

  const changeFilters = (values: DashboardFilterValues) => {
    setFilterValues(values)
    if (dash) void loadData(dash.id, values)
  }

  const persist = async (d: Dash, widgets: Widget[], meta?: { name: string; description: string }, filters?: DashboardFilter[]) => {
    await saveDashboard({ id: d.id, name: meta?.name ?? d.name, description: meta?.description ?? d.description, widgets, ...(filters ? { filters } : {}) })
    await load()
    if (widgets.length && list?.canView) await loadData(d.id, filterValues)
    if (filters && list?.canView) setFilterOptions(await getDashboardFilterOptions(d.id).catch(() => ({})))
  }

  /** Columns of the dashboard's widget datasets (dashboard filters choose one). */
  const filterColumns = (d: Dash) => {
    const seen = new Map<string, { name: string; type: string; masked?: boolean }>()
    for (const name of new Set(d.widgets.map((w) => w.dataset))) for (const c of datasets.find((x) => x.name === name)?.columns ?? []) if (!seen.has(c.name)) seen.set(c.name, c)
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
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

  // Deep links: ?dashboard=<id> (Go to's records), ?new (focus the new dashboard's name).
  useUrlIntents(list !== null, {
    dashboard: (id) => {
      if (list?.dashboards.some((d) => d.id === id)) setSelectedId(id)
    },
    new: () => window.setTimeout(() => document.getElementById('new-dashboard-name')?.focus(), 80),
  })

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.analytics.title')} description={t('pages.analytics.description')} />
      {confirmEl}
      {sharing && dash && <ShareDashboardDialog dashboardId={dash.id} name={dash.name} sharing={dash.sharing} onClose={() => setSharing(false)} onSaved={() => void load()} />}
      {embedding && dash && <EmbedDashboardDialog dashboardId={dash.id} name={dash.name} filterIds={dash.filters.map((f) => f.id)} onClose={() => setEmbedding(false)} />}
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

      {editingFilters && dash && (
        <DashboardFiltersEditor
          initial={dash.filters}
          columns={filterColumns(dash)}
          onCancel={() => setEditingFilters(false)}
          onSave={async (filters) => {
            await persist(dash, dash.widgets, undefined, filters)
            setFilterValues({})
            setEditingFilters(false)
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
            <ul data-tour="analytics-dashboards" className="space-y-1" aria-label={t('insights.analytics.dashboardsLabel')}>
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
                <Input id="new-dashboard-name" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder={t('insights.analytics.newName')} aria-label={t('insights.analytics.newName')} required />
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
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      {dash.name}
                      {dash.sharing.mode === 'restricted' && (
                        <span className="inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-px text-xs font-normal text-muted-foreground">
                          <Lock className="size-3" aria-hidden /> {t('insights.share.restrictedBadge')}
                        </span>
                      )}
                    </h2>
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
                    <Button size="sm" variant="outline" onClick={() => void loadData(dash.id, filterValues)} disabled={loadingData || !dash.widgets.length}>
                      <RefreshCw className={cn('mr-1 h-4 w-4', loadingData && 'animate-spin')} aria-hidden /> {t('common.refresh')}
                    </Button>
                    {dash.widgets.length > 0 && (
                      <a
                        className={buttonVariants({ size: 'sm', variant: 'outline' })}
                        href={`/print/dashboards/${dash.id}${printQuery(filterValues)}`}
                        target="_blank"
                        rel="noopener"
                      >
                        <FileDown className="mr-1 h-4 w-4" aria-hidden /> {t('insights.analytics.exportPdf')}
                      </a>
                    )}
                    {dash.canShare && (
                      <Button size="sm" variant="outline" onClick={() => setSharing(true)}>
                        <Share2 className="mr-1 h-4 w-4" aria-hidden /> {t('insights.share.open')}
                      </Button>
                    )}
                    {list.canEmbed && (
                      <Button size="sm" variant="outline" onClick={() => setEmbedding(true)}>
                        <Code2 className="mr-1 h-4 w-4" aria-hidden /> {t('insights.embed.open')}
                      </Button>
                    )}
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

              {dash.widgets.length > 0 && (
                <DashboardFilterBar filters={dash.filters} values={filterValues} options={filterOptions} onChange={changeFilters} onEdit={list.canEdit ? () => setEditingFilters(true) : undefined} />
              )}

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
                            {r?.ok && r.result.filtersSkipped?.length ? (
                              <p className="truncate text-xs text-warning-text">
                                {t('insights.analytics.dashFilters.notFiltered', { labels: r.result.filtersSkipped.map((s) => dash.filters.find((f) => f.id === s.id)?.label ?? s.id).join(', ') })}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex shrink-0">
                            {r?.ok && (
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => void downloadWidgetPng(w, r.result, w.title, `${dash.name} · ${when(new Date())}`).catch((err) => setError(err instanceof Error ? err.message : t('insights.analytics.pngFailed')))}
                                aria-label={t('insights.analytics.downloadPng', { name: w.title })}
                                title={t('insights.analytics.downloadPng', { name: w.title })}
                              >
                                <ImageDown className="h-4 w-4" aria-hidden />
                              </Button>
                            )}
                            {list.canEdit && (
                              <>
                                <Button size="icon-sm" variant="ghost" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={t('insights.analytics.moveUp', { name: w.title })}><ArrowUp className="h-4 w-4" aria-hidden /></Button>
                                <Button size="icon-sm" variant="ghost" onClick={() => move(i, 1)} disabled={busy || i === dash.widgets.length - 1} aria-label={t('insights.analytics.moveDown', { name: w.title })}><ArrowDown className="h-4 w-4" aria-hidden /></Button>
                                <Button size="icon-sm" variant="ghost" onClick={() => setEditing(w)} aria-label={t('insights.analytics.editWidget', { name: w.title })}><Pencil className="h-4 w-4" aria-hidden /></Button>
                                <Button size="icon-sm" variant="ghost" disabled={busy} onClick={() => void removeWidget(dash, w)} aria-label={t('insights.analytics.removeWidgetLabel', { name: w.title })}><Trash2 className="h-4 w-4" aria-hidden /></Button>
                              </>
                            )}
                          </div>
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
