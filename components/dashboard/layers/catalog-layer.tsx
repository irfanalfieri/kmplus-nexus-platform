'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Database, Eye, Loader2, MousePointerClick, RefreshCw, Save, Search, SearchX, Server, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { PageHeader } from '@/components/dashboard/page-header'
import { useT } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import { deleteDomainMapping, getCatalogSample, listCatalog, refreshCatalogCache, saveCatalogEntry, saveDomainMapping } from '@/lib/actions/catalog'
import { CATALOG_CLASSIFICATIONS, CATALOG_CLASSIFICATION_INFO, freshness, matchesSearch, type CatalogClassification } from '@/lib/catalog/definition'
import { CACHE_REFRESH_LABELS, CACHE_REFRESH_OPTIONS, type CacheRefreshOption } from '@/lib/catalog/refresh'
import { DOMAIN_ENTITIES, DOMAIN_BY_NAME, suggestCanonicalField } from '@/lib/domain/model'
import { NativeSelect } from '@/components/pipelines/step-editors'
import { SampleTable } from '@/components/pipelines/pipeline-editor'
import { useCan } from '@/components/workspace/workspace-context'
import { LineageView } from '@/components/catalog/lineage-graph'
import { QualityHistory } from '@/components/catalog/quality-history'

type Catalog = Awaited<ReturnType<typeof listCatalog>>
type Item = Catalog['items'][number]
type Sample = Awaited<ReturnType<typeof getCatalogSample>>

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

function FreshnessLabel({ item }: { item: Item }) {
  if (item.kind === 'source_table' && item.accessMode === 'live') return <span>live from the source</span>
  return <span title={item.lastLoadedAt ? new Date(item.lastLoadedAt).toLocaleString() : undefined}>{item.kind === 'dataset' ? 'loaded' : 'cached'} {freshness(item.lastLoadedAt)}</span>
}

export default function CatalogLayer() {
  const t = useT()
  const [data, setData] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'dataset' | 'source_table'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await listCatalog())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load the catalog')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(
    () => (data?.items ?? []).filter((i) => (kind === 'all' || i.kind === kind) && matchesSearch(i, query)).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dataset' ? -1 : 1)),
    [data, kind, query]
  )
  const selected = data?.items.find((i) => i.key === selectedKey) ?? null

  return (
    <div className="space-y-6">
      <PageHeader title={t('pages.catalog.title')} description={t('pages.catalog.description')} />

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search names, descriptions, columns, #tags, owners, sources" className="pl-8" aria-label="Search the catalog" />
        </div>
        <NativeSelect className="w-44" value={kind} onChange={(v) => setKind(v as typeof kind)} aria-label="Kind">
          <option value="all">Everything</option>
          <option value="dataset">Nexus datasets</option>
          <option value="source_table">Source tables</option>
        </NativeSelect>
      </div>

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Loading catalog…
          </div>
        )
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<BookOpen />} title="The catalog is empty">
            The catalog fills itself: connect a data source (its tables appear here) or run a pipeline (its datasets appear here).
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,2fr)_3fr]">
          <ul className="max-h-[75vh] space-y-2 overflow-y-auto pr-1" aria-label="Catalog items">
            {items.length === 0 && (
              <li className="rounded-lg border border-border bg-card">
                <EmptyState compact icon={<SearchX />} title={query ? `Nothing matches “${query}”` : 'Nothing of this kind'}>
                  Try another search or kind.
                </EmptyState>
              </li>
            )}
            {items.map((i) => (
              <li key={i.key}>
                <button
                  type="button"
                  onClick={() => setSelectedKey(i.key)}
                  aria-current={selectedKey === i.key ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left text-sm',
                    focusRing,
                    selectedKey === i.key ? 'border-primary bg-accent text-accent-foreground shadow-[inset_3px_0_0_var(--live)]' : 'border-border bg-card hover:bg-muted'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {i.kind === 'dataset' ? <Database className="h-4 w-4 shrink-0 text-live" aria-hidden /> : <Server className="h-4 w-4 shrink-0 text-info" aria-hidden />}
                    <span className="sr-only">{i.kind === 'dataset' ? 'Dataset' : 'Source table'}</span>
                    <span className="truncate font-mono font-medium">{i.name}</span>
                    {i.classification === 'pii' && <Badge variant="outline" className="border-warning/50 bg-warning-soft font-mono text-warning-text">PII</Badge>}
                    {i.kind === 'source_table' && <Badge variant="outline" className="font-mono">{i.accessMode}</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {i.kind === 'dataset' ? (i.producedBy.length ? `by ${i.producedBy.map((p) => p.name).join(', ')}` : 'dataset') : i.sourceName} · {i.rowCount != null ? `${i.rowCount.toLocaleString()} rows · ` : ''}
                    <FreshnessLabel item={i} />
                  </div>
                  {i.description && <div className="mt-1 line-clamp-2 text-xs">{i.description}</div>}
                  {i.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-mono text-[10px]">#{tag}</Badge>
                      ))}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <Detail key={selected.key} item={selected} catalog={data} onSaved={load} onOpen={setSelectedKey} />
          ) : (
            <div className="rounded-lg border border-border bg-card">
              <EmptyState icon={<MousePointerClick />} title="Nothing selected">
                Select a dataset or table to see its columns, lineage and quality.
              </EmptyState>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ item, catalog, onSaved, onOpen }: { item: Item; catalog: Catalog; onSaved: () => Promise<void>; onOpen: (key: string) => void }) {
  const canEdit = catalog.canEdit
  const canPreview = useCan('data:preview')
  const canRun = useCan('pipelines:run')
  const [description, setDescription] = useState(item.description)
  const [ownerId, setOwnerId] = useState(item.ownerId ?? '')
  const [stewardId, setStewardId] = useState(item.stewardId ?? '')
  const [classification, setClassification] = useState<CatalogClassification>(item.classification as CatalogClassification)
  const [tags, setTags] = useState(item.tags.join(', '))
  const [docs, setDocs] = useState<Record<string, string>>(Object.fromEntries(item.columns.map((c) => [c.name, c.doc])))
  const [accessMode, setAccessMode] = useState<'live' | 'cached'>(item.accessMode)
  const [alias, setAlias] = useState(item.alias ?? item.name.replace(/[^a-z0-9_]/gi, '_').toLowerCase())
  const [refresh, setRefresh] = useState<CacheRefreshOption>((item.refresh ?? 'daily') as CacheRefreshOption)
  const [afterPipeline, setAfterPipeline] = useState(item.refreshAfterPipelineId ?? '')
  const [rowLimit, setRowLimit] = useState(item.liveRowLimit ?? 1000)
  const [timeout, setTimeoutSec] = useState(item.liveTimeoutSeconds ?? 30)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [sample, setSample] = useState<Sample | null>(null)
  const [sampling, setSampling] = useState(false)

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await saveCatalogEntry({
        key: item.key,
        description,
        ownerId: ownerId || null,
        stewardId: stewardId || null,
        classification,
        tags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean),
        columnDocs: docs,
        accessMode,
        alias: item.kind === 'source_table' ? alias || null : null,
        refresh,
        refreshAfterPipelineId: refresh === 'after_pipeline' ? afterPipeline || null : null,
        liveRowLimit: rowLimit,
        liveTimeoutSeconds: timeout,
      })
      setNotice(item.kind === 'source_table' && accessMode === 'cached' && item.accessMode !== 'cached' ? `Saved. The first copy into dataset "${alias}" is running in the background.` : 'Saved.')
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const loadSample = async () => {
    setSampling(true)
    setError('')
    try {
      setSample(await getCatalogSample(item.key))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read rows')
    } finally {
      setSampling(false)
    }
  }

  const refreshNow = async () => {
    try {
      const res = await refreshCatalogCache(item.key)
      setNotice(res.status === 'queued' ? 'Refresh queued. It runs in the background; see Monitoring.' : res.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Refresh failed')
    }
  }

  const label = (text: string, child: React.ReactNode) => (
    <label className="block text-sm">
      <span className="mb-1 block text-xs font-medium text-muted-foreground">{text}</span>
      {child}
    </label>
  )

  return (
    <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-5" aria-labelledby="catalog-detail-title">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="catalog-detail-title" className="truncate font-mono text-lg font-semibold">{item.name}</h2>
          <p className="text-xs text-muted-foreground">
            {item.kind === 'dataset' ? 'Nexus dataset' : `Table of ${item.sourceName}`}
            {item.kind === 'dataset' && item.sourceName ? ` · cached copy of ${item.sourceName}` : ''}
            {item.rowCount != null ? ` · ${item.rowCount.toLocaleString()} rows` : ''} · <FreshnessLabel item={item} />
            {item.qualityScore != null && ` · quality ${item.qualityScore}%`}
          </p>
          {item.kind === 'dataset' && item.producedBy.length > 0 && <p className="text-xs text-muted-foreground">Written by {item.producedBy.map((p) => p.name).join(', ')}</p>}
          {item.domains.length > 0 && <p className="text-xs text-muted-foreground">Published as {item.domains.map((d) => DOMAIN_BY_NAME.get(d)?.label ?? d).join(', ')} (Data API)</p>}
        </div>
        {canPreview && (
          <Button size="sm" variant="outline" onClick={() => void loadSample()} disabled={sampling}>
            {sampling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Eye className="mr-1 h-4 w-4" aria-hidden />} Sample rows
          </Button>
        )}
        {canEdit && (
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />} Save
          </Button>
        )}
      </div>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      {sample && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {sample.mode === 'live' ? `Read live from the source just now${sample.pushdown ? '' : ' (filters run in Nexus for this connector)'}` : `From the copy loaded ${freshness(sample.freshness)}`}
            {sample.masked.length ? ` · masked for your role: ${sample.masked.join(', ')}` : ''}
          </p>
          {sample.rows.length ? <SampleTable rows={sample.rows} /> : <p className="text-sm text-muted-foreground">No rows.</p>}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          {label(
            'Description',
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
              rows={3}
              className={cn('w-full rounded-md border border-input bg-card p-2 text-sm disabled:opacity-60', focusRing)}
              placeholder="What is in this table, where it comes from, how to use it"
            />
          )}
        </div>
        {label(
          'Owner',
          <NativeSelect value={ownerId} onChange={setOwnerId} disabled={!canEdit}>
            <option value="">No owner</option>
            {catalog.members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </NativeSelect>
        )}
        {label(
          'Data steward',
          <NativeSelect value={stewardId} onChange={setStewardId} disabled={!canEdit}>
            <option value="">No steward</option>
            {catalog.members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </NativeSelect>
        )}
        {label(
          'Classification',
          <NativeSelect value={classification} onChange={(v) => setClassification(v as CatalogClassification)} disabled={!canEdit}>
            {CATALOG_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{CATALOG_CLASSIFICATION_INFO[c]}</option>
            ))}
          </NativeSelect>
        )}
        {label('Tags (comma-separated)', <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canEdit} placeholder="hr, master-data" />)}
      </div>
      {item.kind === 'dataset' && <p className="text-xs text-muted-foreground">Column masking and row-level access for this dataset are set in Governance.</p>}

      {item.kind === 'source_table' && (
        <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="catalog-access">
          <h3 id="catalog-access" className="flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden /> Access
          </h3>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-labelledby="catalog-access">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={accessMode === 'live'} disabled={!canEdit} onChange={() => setAccessMode('live')} className="mt-1" />
              <span>
                <span className="font-medium">Live query</span>
                <span className="block text-xs text-muted-foreground">Read from the source when someone asks, read-only, with the limits below.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={accessMode === 'cached'} disabled={!canEdit} onChange={() => setAccessMode('cached')} className="mt-1" />
              <span>
                <span className="font-medium">Cached copy</span>
                <span className="block text-xs text-muted-foreground">Copied into a Nexus dataset on a schedule; fast, and usable in Analytics.</span>
              </span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {label('Published name (Data API, and the dataset name when cached)', <Input value={alias} onChange={(e) => setAlias(e.target.value)} disabled={!canEdit} className="font-mono" />)}
            {accessMode === 'live' ? (
              <div className="grid grid-cols-2 gap-2">
                {label('Row limit', <Input type="number" min={10} max={10000} value={rowLimit} onChange={(e) => setRowLimit(Number(e.target.value) || 1000)} disabled={!canEdit} />)}
                {label('Timeout (seconds)', <Input type="number" min={5} max={120} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value) || 30)} disabled={!canEdit} />)}
              </div>
            ) : (
              <div className="space-y-2">
                {label(
                  'Refresh',
                  <NativeSelect value={refresh} onChange={(v) => setRefresh(v as CacheRefreshOption)} disabled={!canEdit}>
                    {CACHE_REFRESH_OPTIONS.map((r) => (
                      <option key={r} value={r}>{CACHE_REFRESH_LABELS[r]}</option>
                    ))}
                  </NativeSelect>
                )}
                {refresh === 'after_pipeline' && (
                  <NativeSelect value={afterPipeline} onChange={setAfterPipeline} disabled={!canEdit} aria-label="Pipeline that triggers the refresh">
                    <option value="">Choose a pipeline…</option>
                    {catalog.pipelines.filter((p) => p.id !== item.cachePipelineId).map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </NativeSelect>
                )}
              </div>
            )}
          </div>
          {item.accessMode === 'cached' && item.cachePipelineId && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              Copy kept by pipeline “Cache · {item.sourceName} · {item.name}” (see Pipelines and Monitoring).
              {canRun && (
                <Button size="sm" variant="outline" onClick={() => void refreshNow()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> Refresh now
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="catalog-columns">
        <h3 id="catalog-columns" className="mb-2 text-sm font-medium">Columns</h3>
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <Table label={`Columns of ${item.name}`}>
            <THead className="sticky top-0 z-10 bg-muted">
              <tr>
                <Th>Column</Th>
                <Th>Type</Th>
                <Th>Business description</Th>
              </tr>
            </THead>
            <TBody>
              {item.columns.map((c) => (
                <Tr key={c.name}>
                  <Td className="py-1 font-mono text-xs whitespace-nowrap">{c.name}</Td>
                  <Td className="py-1 font-mono text-xs text-muted-foreground">{c.type}</Td>
                  <Td className="py-1">
                    {canEdit ? (
                      <Input className="h-7 text-xs" value={docs[c.name] ?? ''} onChange={(e) => setDocs({ ...docs, [c.name]: e.target.value })} aria-label={`Description of ${c.name}`} />
                    ) : (
                      <span className="text-xs">{docs[c.name] || '—'}</span>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="catalog-lineage">
        <h3 id="catalog-lineage" className="mb-2 text-sm font-medium">Lineage</h3>
        <LineageView catalogKey={item.key} onOpen={onOpen} />
      </section>

      {item.kind === 'dataset' && (
        <section aria-labelledby="catalog-quality">
          <h3 id="catalog-quality" className="mb-2 text-sm font-medium">Quality</h3>
          <QualityHistory datasetName={item.name} />
        </section>
      )}

      {item.kind === 'dataset' && <DomainMapping item={item} catalog={catalog} onSaved={onSaved} />}
    </section>
  )
}

function DomainMapping({ item, catalog, onSaved }: { item: Item; catalog: Catalog; onSaved: () => Promise<void> }) {
  const existing = catalog.domainMappings.find((m) => m.datasetName === item.name)
  const [entity, setEntity] = useState(existing?.entity ?? '')
  const [fields, setFields] = useState<Record<string, string>>(existing?.fields ?? {})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const def = DOMAIN_BY_NAME.get(entity)
  const taken = catalog.domainMappings.find((m) => m.entity === entity && m.datasetName !== item.name)
  const [confirm, confirmEl] = useConfirm()

  const choose = (name: string) => {
    setEntity(name)
    const e = DOMAIN_BY_NAME.get(name)
    if (!e) return setFields({})
    // Auto-map columns whose names match a canonical field or a known synonym.
    const auto: Record<string, string> = {}
    for (const c of item.columns) {
      const canonical = suggestCanonicalField(c.name, e)
      if (canonical && !auto[canonical]) auto[canonical] = c.name
    }
    setFields(existing?.entity === name ? existing.fields : auto)
  }

  const save = async () => {
    if (
      taken &&
      !(await confirm({
        title: `Move ${def?.label ?? entity} to ${item.name}?`,
        description: `GET /api/v1/domains/${entity} currently reads ${taken.datasetName}. Apps using it get rows from ${item.name} after you publish.`,
        confirmLabel: 'Publish mapping',
      }))
    )
      return
    setBusy(true)
    setMessage(null)
    try {
      await saveDomainMapping({ entity, datasetName: item.name, fields })
      setMessage({ ok: true, text: `Published as ${def?.label}: GET /api/v1/domains/${entity}` })
      await onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Save failed' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    const ok = await confirm({
      title: `Unpublish ${DOMAIN_BY_NAME.get(existing.entity)?.label ?? existing.entity}?`,
      description: `GET /api/v1/domains/${existing.entity} stops returning rows. KMPlus apps that read it get nothing until it is published again.`,
      confirmLabel: 'Unpublish',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteDomainMapping(existing.entity)
      setEntity('')
      setFields({})
      await onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'Remove failed' })
    }
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-labelledby="catalog-entity">
      {confirmEl}
      <h3 id="catalog-entity" className="text-sm font-medium">Publish as a business entity</h3>
      <p className="text-xs text-muted-foreground">KMPlus apps read standard entities (Employee, Organization, Position…) from the Data API instead of raw tables. Map this dataset&apos;s columns to the entity&apos;s fields.</p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-56" value={entity} onChange={choose} disabled={!catalog.canEdit} aria-label="Entity">
          <option value="">Not published</option>
          {DOMAIN_ENTITIES.map((e) => (
            <option key={e.name} value={e.name}>{e.label}</option>
          ))}
        </NativeSelect>
        {taken && (
          <span className="flex items-center gap-1.5 text-xs text-warning-text">
            <span className="size-2 shrink-0 rounded-[1px] bg-warning" aria-hidden />
            Currently published from <span className="font-mono">{taken.datasetName}</span>; saving moves it here.
          </span>
        )}
      </div>
      {def && (
        <>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {def.fields.map((f) => (
              <label key={f.name} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate" title={f.name}>
                  {f.label}
                  {f.name === def.key && ' *'}
                  {f.pii && <span className="ml-1 font-mono text-warning-text">PII</span>}
                </span>
                <NativeSelect className="h-7 text-xs" value={fields[f.name] ?? ''} onChange={(v) => setFields({ ...fields, [f.name]: v })} disabled={!catalog.canEdit} aria-label={`Column for ${f.label}`}>
                  <option value="">—</option>
                  {item.columns.map((c) => (
                    <option key={c.name} value={c.name}>{c.name}</option>
                  ))}
                </NativeSelect>
              </label>
            ))}
          </div>
          {catalog.canEdit && (
            <div className="flex gap-2">
              <Button size="sm" onClick={() => void save()} disabled={busy}>
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />} Publish mapping
              </Button>
              {existing?.entity === entity && (
                <Button size="sm" variant="ghost" onClick={() => void remove()}>
                  Unpublish
                </Button>
              )}
            </div>
          )}
        </>
      )}
      {message && <Notice tone={message.ok ? 'success' : 'danger'}>{message.text}</Notice>}
    </section>
  )
}
