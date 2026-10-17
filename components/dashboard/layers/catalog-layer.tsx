'use client'

import { AiCatalogAsk } from '@/components/ai/ai-catalog-ask'
import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Database, Eye, Loader2, MousePointerClick, Plus, RefreshCw, Save, Search, SearchX, Server, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { PageHeader } from '@/components/dashboard/page-header'
import { useHashTarget, useUrlIntents } from '@/components/dashboard/url-intents'
import { usePrefs, useT } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import { insights } from '@/lib/i18n/messages/en/insights'
import { freshnessT } from '@/components/analytics/charts'
import { cn } from '@/lib/utils'
import { deleteDomainMapping, getCatalogSample, listCatalog, refreshCatalogCache, saveCatalogEntry, saveDomainMapping } from '@/lib/actions/catalog'
import { CATALOG_CLASSIFICATIONS, matchesSearch, type CatalogClassification } from '@/lib/catalog/definition'
import { CACHE_REFRESH_OPTIONS, type CacheRefreshOption } from '@/lib/catalog/refresh'
import { DOMAIN_ENTITIES, DOMAIN_BY_NAME, suggestCanonicalField, type DomainField } from '@/lib/domain/model'
import { NativeSelect } from '@/components/pipelines/step-editors'
import { SampleTable } from '@/components/pipelines/pipeline-editor'
import { useCan } from '@/components/workspace/workspace-context'
import { LineageView } from '@/components/catalog/lineage-graph'
import { QualityHistory } from '@/components/catalog/quality-history'
import { DatasetSchemaPanel, DefineFrom } from '@/components/catalog/dataset-schema'
import { UpgradeBanner } from '@/components/upgrades/upgrade-banner'
import { Modal } from '@/components/ui/dialog'
import { defineDatasetSchema } from '@/lib/actions/schemas'

type Catalog = Awaited<ReturnType<typeof listCatalog>>
type Item = Catalog['items'][number]
type Sample = Awaited<ReturnType<typeof getCatalogSample>>

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

/** Business entity and field names in the interface language (lib/domain/model holds them in English). */
const entityLabel = (t: Translate, name: string, fallback: string) =>
  name in insights.catalog.entities ? t(`insights.catalog.entities.${name as keyof typeof insights.catalog.entities}`) : fallback
const fieldLabel = (t: Translate, f: DomainField) => (f.name in insights.catalog.fields ? t(`insights.catalog.fields.${f.name as keyof typeof insights.catalog.fields}`) : f.label)

/** Puts a React node where `{name}` stands in a translated sentence. */
function withNode(text: string, name: string, node: React.ReactNode) {
  return text.split(`{${name}}`).map((part, i) => (
    <Fragment key={i}>
      {i > 0 && node}
      {part}
    </Fragment>
  ))
}

function FreshnessLabel({ item }: { item: Item }) {
  const { t, formatDateTime } = usePrefs()
  if (item.kind === 'source_table' && item.accessMode === 'live') return <span>{t('insights.catalog.liveFromSource')}</span>
  const when = freshnessT(item.lastLoadedAt, t)
  return (
    <span title={item.lastLoadedAt ? t('insights.time.wib', { time: formatDateTime(item.lastLoadedAt) }) : undefined}>
      {item.kind === 'dataset' ? t('insights.catalog.loadedAgo', { when }) : t('insights.catalog.cachedAgo', { when })}
    </span>
  )
}

export default function CatalogLayer() {
  const { t, formatNumber } = usePrefs()
  const [data, setData] = useState<Catalog | null>(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | 'dataset' | 'source_table'>('all')
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await listCatalog())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.catalog.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const items = useMemo(
    () => (data?.items ?? []).filter((i) => (kind === 'all' || i.kind === kind) && matchesSearch(i, query)).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dataset' ? -1 : 1)),
    [data, kind, query]
  )
  const selected = data?.items.find((i) => i.key === selectedKey) ?? null

  // Deep links: ?item=dataset:<name> (Go to's records), ?new, ?ask.
  useUrlIntents(data !== null, {
    item: (key) => {
      if (!data?.items.some((i) => i.key === key)) return
      setKind('all')
      setQuery('')
      setSelectedKey(key)
    },
    new: () => data?.canEdit && setCreating(true),
    ask: () => window.setTimeout(() => document.querySelector<HTMLInputElement>('#catalog-ask input, #catalog-ask textarea')?.focus(), 80),
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('pages.catalog.title')}
        description={t('pages.catalog.description')}
        actions={
          data?.canEdit && (
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
              <Plus className="mr-1 h-4 w-4" aria-hidden /> {t('schemas.newDataset.button')}
            </Button>
          )
        }
      />
      <UpgradeBanner screen="catalog" onChanged={() => void load()} />
      {creating && (
        <NewDataset
          onClose={() => setCreating(false)}
          onCreated={async (name) => {
            setCreating(false)
            await load()
            setSelectedKey(`dataset:${name}`)
          }}
        />
      )}

      {error && <Notice tone="danger">{error}</Notice>}

      <div className="flex flex-wrap items-center gap-2">
        <div data-tour="catalog-search" className="relative min-w-[240px] flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('insights.catalog.searchPlaceholder')} className="pl-8" aria-label={t('insights.catalog.searchLabel')} />
        </div>
        <NativeSelect className="w-44" value={kind} onChange={(v) => setKind(v as typeof kind)} aria-label={t('insights.catalog.kindLabel')}>
          <option value="all">{t('insights.catalog.kindAll')}</option>
          <option value="dataset">{t('insights.catalog.kindDatasets')}</option>
          <option value="source_table">{t('insights.catalog.kindSourceTables')}</option>
        </NativeSelect>
      </div>

      {data && data.items.length > 0 && (
        <div id="catalog-ask">
          <AiCatalogAsk
            onOpen={(key) => {
              setKind('all')
              setQuery('')
              setSelectedKey(key)
            }}
          />
        </div>
      )}

      {!data ? (
        !error && (
          <div className="flex items-center justify-center rounded-lg border border-border bg-card p-10 text-muted-foreground" role="status">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> {t('insights.catalog.loading')}
          </div>
        )
      ) : data.items.length === 0 ? (
        <div className="rounded-lg border border-border bg-card">
          <EmptyState icon={<BookOpen />} title={t('insights.catalog.emptyTitle')}>
            {t('insights.catalog.emptyBody')}
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(280px,2fr)_3fr]">
          <ul className="max-h-[75vh] space-y-2 overflow-y-auto pr-1" aria-label={t('insights.catalog.itemsLabel')}>
            {items.length === 0 && (
              <li className="rounded-lg border border-border bg-card">
                <EmptyState compact icon={<SearchX />} title={query ? t('insights.catalog.noMatchTitle', { query }) : t('insights.catalog.noKindTitle')}>
                  {t('insights.catalog.noMatchBody')}
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
                    <span className="sr-only">{i.kind === 'dataset' ? t('insights.catalog.kindDataset') : t('insights.catalog.kindSourceTable')}</span>
                    <span className="truncate font-mono font-medium">{i.name}</span>
                    {i.classification === 'pii' && <Badge variant="outline" className="border-warning/50 bg-warning-soft font-mono text-warning-text">PII</Badge>}
                    {i.kind === 'source_table' && <Badge variant="outline" className="font-mono">{t(`insights.catalog.accessModes.${i.accessMode}`)}</Badge>}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {i.kind === 'dataset'
                      ? i.producedBy.length
                        ? t('insights.catalog.producedBy', { names: i.producedBy.map((p) => p.name).join(', ') })
                        : t('insights.catalog.datasetFallback')
                      : i.sourceName}{' '}
                    · {i.rowCount != null ? `${t('insights.catalog.rows', { count: formatNumber(i.rowCount) })} · ` : ''}
                    <FreshnessLabel item={i} />
                  </div>
                  {i.description && <div className="mt-1 line-clamp-2 text-xs">{i.description}</div>}
                  {i.tags.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {i.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="font-mono text-[11px]">#{tag}</Badge>
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
              <EmptyState icon={<MousePointerClick />} title={t('insights.catalog.nothingSelectedTitle')}>
                {t('insights.catalog.nothingSelectedBody')}
              </EmptyState>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Detail({ item, catalog, onSaved, onOpen }: { item: Item; catalog: Catalog; onSaved: () => Promise<void>; onOpen: (key: string) => void }) {
  const { t, formatNumber } = usePrefs()
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
        tags: tags.split(',').map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean),
        columnDocs: docs,
        accessMode,
        alias: item.kind === 'source_table' ? alias || null : null,
        refresh,
        refreshAfterPipelineId: refresh === 'after_pipeline' ? afterPipeline || null : null,
        liveRowLimit: rowLimit,
        liveTimeoutSeconds: timeout,
      })
      setNotice(item.kind === 'source_table' && accessMode === 'cached' && item.accessMode !== 'cached' ? t('insights.catalog.detail.savedCaching', { alias }) : t('insights.catalog.detail.saved'))
      await onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.catalog.detail.saveFailed'))
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
      setError(err instanceof Error ? err.message : t('insights.catalog.detail.readFailed'))
    } finally {
      setSampling(false)
    }
  }

  const refreshNow = async () => {
    try {
      const res = await refreshCatalogCache(item.key)
      setNotice(res.status === 'queued' ? t('insights.catalog.detail.refreshQueued') : res.message)
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.catalog.detail.refreshFailed'))
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
            {item.kind === 'dataset' ? t('insights.catalog.detail.nexusDataset') : t('insights.catalog.detail.tableOf', { source: item.sourceName ?? '' })}
            {item.kind === 'dataset' && item.sourceName ? ` · ${t('insights.catalog.detail.cachedCopyOf', { source: item.sourceName })}` : ''}
            {item.rowCount != null ? ` · ${t('insights.catalog.rows', { count: formatNumber(item.rowCount) })}` : ''} · <FreshnessLabel item={item} />
            {item.qualityScore != null && ` · ${t('insights.catalog.detail.qualityScore', { score: item.qualityScore })}`}
          </p>
          {item.kind === 'dataset' && item.producedBy.length > 0 && (
            <p className="text-xs text-muted-foreground">{t('insights.catalog.detail.writtenBy', { names: item.producedBy.map((p) => p.name).join(', ') })}</p>
          )}
          {item.domains.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t('insights.catalog.detail.publishedAs', { entities: item.domains.map((d) => entityLabel(t, d, DOMAIN_BY_NAME.get(d)?.label ?? d)).join(', ') })}
            </p>
          )}
        </div>
        {canPreview && (
          <Button size="sm" variant="outline" onClick={() => void loadSample()} disabled={sampling}>
            {sampling ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Eye className="mr-1 h-4 w-4" aria-hidden />} {t('insights.catalog.detail.sampleRows')}
          </Button>
        )}
        {canEdit && (
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden /> : <Save className="mr-1 h-4 w-4" aria-hidden />} {t('common.save')}
          </Button>
        )}
      </div>
      {notice && <Notice tone="success">{notice}</Notice>}
      {error && <Notice tone="danger">{error}</Notice>}

      {sample && (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            {sample.mode === 'live'
              ? sample.pushdown
                ? t('insights.catalog.detail.sampleLive')
                : t('insights.catalog.detail.sampleLiveNoPushdown')
              : t('insights.catalog.detail.sampleCopy', { when: freshnessT(sample.freshness, t) })}
            {sample.masked.length ? ` · ${t('insights.catalog.detail.sampleMasked', { columns: sample.masked.join(', ') })}` : ''}
          </p>
          {sample.rows.length ? <SampleTable rows={sample.rows} /> : <p className="text-sm text-muted-foreground">{t('insights.catalog.detail.noRows')}</p>}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div className="md:col-span-2">
          {label(
            t('insights.catalog.detail.description'),
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={!canEdit}
              rows={3}
              className={cn('w-full rounded-md border border-input bg-card p-2 text-sm disabled:opacity-60', focusRing)}
              placeholder={t('insights.catalog.detail.descriptionPlaceholder')}
            />
          )}
        </div>
        {label(
          t('insights.catalog.detail.owner'),
          <NativeSelect value={ownerId} onChange={setOwnerId} disabled={!canEdit}>
            <option value="">{t('insights.catalog.detail.noOwner')}</option>
            {catalog.members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </NativeSelect>
        )}
        {label(
          t('insights.catalog.detail.steward'),
          <NativeSelect value={stewardId} onChange={setStewardId} disabled={!canEdit}>
            <option value="">{t('insights.catalog.detail.noSteward')}</option>
            {catalog.members.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </NativeSelect>
        )}
        {label(
          t('insights.catalog.detail.classification'),
          <NativeSelect value={classification} onChange={(v) => setClassification(v as CatalogClassification)} disabled={!canEdit}>
            {CATALOG_CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>{t(`insights.catalog.classifications.${c}`)}</option>
            ))}
          </NativeSelect>
        )}
        {label(t('insights.catalog.detail.tags'), <Input value={tags} onChange={(e) => setTags(e.target.value)} disabled={!canEdit} placeholder="hr, master-data" />)}
      </div>
      {item.kind === 'dataset' && <p className="text-xs text-muted-foreground">{t('insights.catalog.detail.governanceHint')}</p>}

      {item.kind === 'source_table' && (
        <section className="space-y-3 rounded-md border border-border p-3" aria-labelledby="catalog-access">
          <h3 id="catalog-access" className="flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden /> {t('insights.catalog.detail.access')}
          </h3>
          <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-labelledby="catalog-access">
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={accessMode === 'live'} disabled={!canEdit} onChange={() => setAccessMode('live')} className="mt-1" />
              <span>
                <span className="font-medium">{t('insights.catalog.detail.liveQuery')}</span>
                <span className="block text-xs text-muted-foreground">{t('insights.catalog.detail.liveQueryHelp')}</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={accessMode === 'cached'} disabled={!canEdit} onChange={() => setAccessMode('cached')} className="mt-1" />
              <span>
                <span className="font-medium">{t('insights.catalog.detail.cachedCopy')}</span>
                <span className="block text-xs text-muted-foreground">{t('insights.catalog.detail.cachedCopyHelp')}</span>
              </span>
            </label>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {label(t('insights.catalog.detail.publishedName'), <Input value={alias} onChange={(e) => setAlias(e.target.value)} disabled={!canEdit} className="font-mono" />)}
            {accessMode === 'live' ? (
              <div className="grid grid-cols-2 gap-2">
                {label(t('insights.catalog.detail.rowLimit'), <Input type="number" min={10} max={10000} value={rowLimit} onChange={(e) => setRowLimit(Number(e.target.value) || 1000)} disabled={!canEdit} />)}
                {label(t('insights.catalog.detail.timeout'), <Input type="number" min={5} max={120} value={timeout} onChange={(e) => setTimeoutSec(Number(e.target.value) || 30)} disabled={!canEdit} />)}
              </div>
            ) : (
              <div className="space-y-2">
                {label(
                  t('insights.catalog.detail.refresh'),
                  <NativeSelect value={refresh} onChange={(v) => setRefresh(v as CacheRefreshOption)} disabled={!canEdit}>
                    {CACHE_REFRESH_OPTIONS.map((r) => (
                      <option key={r} value={r}>{t(`insights.catalog.refreshOptions.${r}`)}</option>
                    ))}
                  </NativeSelect>
                )}
                {refresh === 'after_pipeline' && (
                  <NativeSelect value={afterPipeline} onChange={setAfterPipeline} disabled={!canEdit} aria-label={t('insights.catalog.detail.refreshPipeline')}>
                    <option value="">{t('insights.catalog.detail.choosePipeline')}</option>
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
              {t('insights.catalog.detail.cacheKeptBy', { source: item.sourceName ?? '', table: item.name })}
              {canRun && (
                <Button size="sm" variant="outline" onClick={() => void refreshNow()}>
                  <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden /> {t('insights.catalog.detail.refreshNow')}
                </Button>
              )}
            </div>
          )}
        </section>
      )}

      <section aria-labelledby="catalog-columns">
        <h3 id="catalog-columns" className="mb-2 text-sm font-medium">{t('insights.catalog.detail.columns')}</h3>
        <div className="max-h-96 overflow-auto rounded-md border border-border">
          <Table label={t('insights.catalog.detail.columnsOf', { name: item.name })}>
            <THead className="sticky top-0 z-10 bg-muted">
              <tr>
                <Th>{t('insights.catalog.detail.colColumn')}</Th>
                <Th>{t('insights.catalog.detail.colType')}</Th>
                <Th>{t('insights.catalog.detail.colDescription')}</Th>
              </tr>
            </THead>
            <TBody>
              {item.columns.map((c) => (
                <Tr key={c.name}>
                  <Td className="py-1 font-mono text-xs whitespace-nowrap">{c.name}</Td>
                  <Td className="py-1 font-mono text-xs text-muted-foreground">{c.type}</Td>
                  <Td className="py-1">
                    {canEdit ? (
                      <Input className="h-7 text-xs" value={docs[c.name] ?? ''} onChange={(e) => setDocs({ ...docs, [c.name]: e.target.value })} aria-label={t('insights.catalog.detail.descriptionOf', { column: c.name })} />
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

      {item.kind === 'dataset' && (
        <section aria-labelledby="catalog-schema">
          <h3 id="catalog-schema" className="mb-2 text-sm font-medium">{t('schemas.panel.title')}</h3>
          <DatasetSchemaPanel datasetName={item.name} onChanged={() => void onSaved()} />
        </section>
      )}

      <section aria-labelledby="catalog-lineage">
        <h3 id="catalog-lineage" className="mb-2 text-sm font-medium">{t('insights.catalog.detail.lineage')}</h3>
        <LineageView catalogKey={item.key} onOpen={onOpen} />
      </section>

      {item.kind === 'dataset' && (
        <section aria-labelledby="catalog-quality">
          <h3 id="catalog-quality" className="mb-2 text-sm font-medium">{t('insights.catalog.detail.quality')}</h3>
          <QualityHistory datasetName={item.name} />
        </section>
      )}

      {item.kind === 'dataset' && <DomainMapping item={item} catalog={catalog} onSaved={onSaved} />}
    </section>
  )
}

function DomainMapping({ item, catalog, onSaved }: { item: Item; catalog: Catalog; onSaved: () => Promise<void> }) {
  const t = useT()
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
        title: t('insights.catalog.entity.moveTitle', { entity: entityLabel(t, entity, def?.label ?? entity), dataset: item.name }),
        description: t('insights.catalog.entity.moveBody', { name: entity, current: taken.datasetName, dataset: item.name }),
        confirmLabel: t('insights.catalog.entity.publish'),
      }))
    )
      return
    setBusy(true)
    setMessage(null)
    try {
      await saveDomainMapping({ entity, datasetName: item.name, fields })
      setMessage({ ok: true, text: t('insights.catalog.entity.published', { entity: entityLabel(t, entity, def?.label ?? entity), name: entity }) })
      await onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t('insights.catalog.entity.saveFailed') })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!existing) return
    const ok = await confirm({
      title: t('insights.catalog.entity.unpublishTitle', { entity: entityLabel(t, existing.entity, DOMAIN_BY_NAME.get(existing.entity)?.label ?? existing.entity) }),
      description: t('insights.catalog.entity.unpublishBody', { name: existing.entity }),
      confirmLabel: t('insights.catalog.entity.unpublish'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await deleteDomainMapping(existing.entity)
      setEntity('')
      setFields({})
      await onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : t('insights.catalog.entity.removeFailed') })
    }
  }

  return (
    <section className="space-y-2 rounded-md border border-border p-3" aria-labelledby="catalog-entity">
      {confirmEl}
      <h3 id="catalog-entity" className="text-sm font-medium">{t('insights.catalog.entity.title')}</h3>
      <p className="text-xs text-muted-foreground">{t('insights.catalog.entity.body')}</p>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect className="w-56" value={entity} onChange={choose} disabled={!catalog.canEdit} aria-label={t('insights.catalog.entity.label')}>
          <option value="">{t('insights.catalog.entity.notPublished')}</option>
          {DOMAIN_ENTITIES.map((e) => (
            <option key={e.name} value={e.name}>{entityLabel(t, e.name, e.label)}</option>
          ))}
        </NativeSelect>
        {taken && (
          <span className="flex items-center gap-1.5 text-xs text-warning-text">
            <span className="size-2 shrink-0 rounded-[1px] bg-warning" aria-hidden />
            <span>{withNode(t('insights.catalog.entity.currentlyFrom'), 'dataset', <span className="font-mono">{taken.datasetName}</span>)}</span>
          </span>
        )}
      </div>
      {def && (
        <>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {def.fields.map((f) => (
              <label key={f.name} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate" title={f.name}>
                  {fieldLabel(t, f)}
                  {f.name === def.key && ' *'}
                  {f.pii && <span className="ml-1 font-mono text-warning-text">PII</span>}
                </span>
                <NativeSelect className="h-7 text-xs" value={fields[f.name] ?? ''} onChange={(v) => setFields({ ...fields, [f.name]: v })} disabled={!catalog.canEdit} aria-label={t('insights.catalog.entity.columnFor', { field: fieldLabel(t, f) })}>
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
                {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />} {t('insights.catalog.entity.publish')}
              </Button>
              {existing?.entity === entity && (
                <Button size="sm" variant="ghost" onClick={() => void remove()}>
                  {t('insights.catalog.entity.unpublish')}
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

/** A new, empty dataset with a defined schema (pipelines then map onto it). */
function NewDataset({ onClose, onCreated }: { onClose: () => void; onCreated: (name: string) => Promise<void> }) {
  const { t } = usePrefs()
  const [name, setName] = useState('')
  const [from, setFrom] = useState<{ from: 'entity' | 'example'; entity: string; example: string }>({ from: 'entity', entity: '', example: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      await defineDatasetSchema({ datasetName: name.trim(), from: from.from, entity: from.entity, example: from.example })
      await onCreated(name.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.catalog.detail.saveFailed'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal
      title={t('schemas.newDataset.title')}
      description={t('schemas.newDataset.description')}
      onClose={onClose}
      dirty={Boolean(name || from.entity || from.example)}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button disabled={busy || !name.trim() || (from.from === 'entity' ? !from.entity : !from.example.trim())} onClick={() => void create()}>
            {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />} {t('schemas.newDataset.create')}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <label className="block text-sm">
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('schemas.newDataset.name')}</span>
          <Input value={name} onChange={(e) => setName(e.target.value.toLowerCase())} placeholder="employee_profile" className="font-mono" />
        </label>
        <DefineFrom
          value={from}
          onChange={(v) => {
            setFrom(v)
            if (!name && v.entity && v.from === 'entity') setName(v.entity)
          }}
        />
      </div>
    </Modal>
  )
}
