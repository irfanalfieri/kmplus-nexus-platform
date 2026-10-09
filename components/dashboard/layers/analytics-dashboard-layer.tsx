'use client'

import { useCallback, useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, BarChart3, Database, Loader2, Pencil, Plus, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { deleteDashboard, getAnalyticsDatasets, getDashboardData, listDashboards, saveDashboard } from '@/lib/actions/analytics'
import type { Widget } from '@/lib/analytics/definition'
import { WidgetView } from '@/components/analytics/charts'
import WidgetEditor, { newWidget } from '@/components/analytics/widget-editor'

type List = Awaited<ReturnType<typeof listDashboards>>
type Dash = List['dashboards'][number]
type Datasets = Awaited<ReturnType<typeof getAnalyticsDatasets>>
type Results = Awaited<ReturnType<typeof getDashboardData>>['results']

const when = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(d)) + ' WIB'

export default function AnalyticsDashboardLayer({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [list, setList] = useState<List | null>(null)
  const [datasets, setDatasets] = useState<Datasets>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [loadingData, setLoadingData] = useState(false)
  const [editing, setEditing] = useState<Widget | null>(null)
  const [newName, setNewName] = useState('')
  const [rename, setRename] = useState<{ name: string; description: string } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
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
      setError(err instanceof Error ? err.message : 'Failed to load Analytics')
    }
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
      setError(err instanceof Error ? err.message : 'Failed to load dashboard data')
    } finally {
      setLoadingData(false)
    }
  }, [])

  useEffect(() => {
    setResults(null)
    setConfirmDelete(false)
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
      setError(err instanceof Error ? err.message : 'Could not create the dashboard')
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
      setError(err instanceof Error ? err.message : 'Something went wrong')
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

  return (
    <div className="space-y-6">
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

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-primary" />
          <Badge variant="outline">Layer 10</Badge>
        </div>
        <h2 className="text-2xl font-bold">Analytics</h2>
        <p className="mt-1 text-muted-foreground">Dashboards built from the datasets your pipelines produce. Pick a measure, group it, filter it; no SQL. Columns masked by a Governance policy are hidden for roles that see masked data.</p>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

      {!list ? (
        !error && (
          <div className="flex items-center justify-center rounded-xl border border-border bg-card p-10 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading dashboards…
          </div>
        )
      ) : !list.canView ? (
        <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">Your role can&apos;t see data contents, so dashboards aren&apos;t available. Ask a workspace admin for the Analyst role.</p>
      ) : datasets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center">
          <Database className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
          <p className="font-medium">No datasets yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Dashboards read the datasets your pipelines write. Create a pipeline with a &ldquo;Nexus dataset&rdquo; destination and run it once.</p>
          <Button className="mt-4" onClick={() => onNavigate('pipelines')}>Go to Pipelines</Button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
          <aside className="space-y-3">
            <ul className="space-y-1" aria-label="Dashboards">
              {list.dashboards.map((d) => (
                <li key={d.id}>
                  <button
                    onClick={() => setSelectedId(d.id)}
                    aria-current={d.id === selectedId}
                    className={`w-full rounded-md px-3 py-2 text-left text-sm ${d.id === selectedId ? 'bg-primary/10 text-primary' : 'hover:bg-muted'}`}
                  >
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="text-xs text-muted-foreground">{d.widgets.length} widget{d.widgets.length === 1 ? '' : 's'}</div>
                  </button>
                </li>
              ))}
              {list.dashboards.length === 0 && <li className="px-3 py-2 text-sm text-muted-foreground">No dashboards yet.</li>}
            </ul>
            {list.canEdit && (
              <form onSubmit={create} className="space-y-2 rounded-lg border border-border p-3">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New dashboard name" aria-label="New dashboard name" required />
                <Button type="submit" size="sm" className="w-full" disabled={busy || !newName.trim()}>
                  <Plus className="mr-1 h-4 w-4" /> Create dashboard
                </Button>
              </form>
            )}
          </aside>

          {!dash ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">{list.canEdit ? 'Create your first dashboard on the left.' : 'No dashboards in this workspace yet.'}</div>
          ) : (
            <section className="min-w-0 space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border bg-card p-4">
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
                    <Input value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} className="max-w-xs" aria-label="Dashboard name" required />
                    <Input value={rename.description} onChange={(e) => setRename({ ...rename, description: e.target.value })} placeholder="Description (optional)" className="max-w-md" aria-label="Dashboard description" />
                    <Button type="submit" size="sm" disabled={busy}><Save className="mr-1 h-4 w-4" /> Save</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setRename(null)}>Cancel</Button>
                  </form>
                ) : (
                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">{dash.name}</h3>
                    <p className="text-xs text-muted-foreground">{dash.description ? `${dash.description} · ` : ''}updated {when(dash.updatedAt)}</p>
                  </div>
                )}
                {!rename && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" onClick={() => void loadData(dash.id)} disabled={loadingData || !dash.widgets.length}>
                      <RefreshCw className={`mr-1 h-4 w-4 ${loadingData ? 'animate-spin' : ''}`} /> Refresh
                    </Button>
                    {list.canEdit && (
                      <>
                        <Button size="sm" onClick={() => setEditing(newWidget(datasets[0].name))} disabled={dash.widgets.length >= 24}>
                          <Plus className="mr-1 h-4 w-4" /> Add widget
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setRename({ name: dash.name, description: dash.description })} aria-label="Rename dashboard">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        {confirmDelete ? (
                          <span className="flex items-center gap-1 text-xs">
                            Delete this dashboard?
                            <Button size="sm" variant="destructive" disabled={busy} onClick={() => void act(async () => { await deleteDashboard(dash.id); setSelectedId(null); await load() })}>Delete</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                          </span>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} aria-label="Delete dashboard">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>

              {dash.widgets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
                  {list.canEdit ? 'Empty dashboard. Add a widget: for example "Count rows by department".' : 'This dashboard has no widgets yet.'}
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {dash.widgets.map((w, i) => {
                    const r = results?.[w.id]
                    return (
                      <article key={w.id} className={`min-w-0 rounded-xl border border-border bg-card p-4 ${w.size === 'wide' ? 'md:col-span-2' : ''}`}>
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h4 className="truncate font-medium">{w.title}</h4>
                            <p className="truncate text-xs text-muted-foreground">
                              {w.dataset}
                              {w.filters.length ? ` · ${w.filters.length} filter${w.filters.length === 1 ? '' : 's'}` : ''}
                            </p>
                          </div>
                          {list.canEdit && (
                            <div className="flex shrink-0">
                              <Button size="sm" variant="ghost" onClick={() => move(i, -1)} disabled={busy || i === 0} aria-label={`Move ${w.title} up`}><ArrowUp className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => move(i, 1)} disabled={busy || i === dash.widgets.length - 1} aria-label={`Move ${w.title} down`}><ArrowDown className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(w)} aria-label={`Edit ${w.title}`}><Pencil className="h-4 w-4" /></Button>
                              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => persist(dash, dash.widgets.filter((x) => x.id !== w.id)))} aria-label={`Remove ${w.title}`}><Trash2 className="h-4 w-4" /></Button>
                            </div>
                          )}
                        </div>
                        {!r ? (
                          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</div>
                        ) : r.ok ? (
                          <WidgetView widget={w} result={r.result} />
                        ) : (
                          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{r.message}</p>
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
