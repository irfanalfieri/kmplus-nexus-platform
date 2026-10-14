'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, ChevronLeft, ChevronRight, Loader2, Play, RefreshCw, ShieldCheck, Wrench, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog, Modal, useConfirm } from '@/components/ui/dialog'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { Breaker } from '@/components/ui/flow-line'
import { useToast } from '@/components/ui/toast'
import { approveRows, bulkFix, dismissRows, fixRow, getQualityOverview, listQuarantine, replayRows, restoreRows } from '@/lib/actions/quality'
import { useCan } from '@/components/workspace/workspace-context'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { PageHeader } from '@/components/dashboard/page-header'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import type { MessageKey } from '@/lib/i18n/translate'
import { localizeCheck } from '@/lib/pipelines/check-messages'
import { localizeStepTitle } from '@/components/pipelines/step-title'

type Overview = Awaited<ReturnType<typeof getQualityOverview>>
type Item = Awaited<ReturnType<typeof listQuarantine>>['rows'][number]
type Status = 'open' | 'fixed' | 'approved' | 'replayed' | 'dismissed' | 'superseded'
type Kind = 'invalid' | 'approval' | 'flag'

/** The inbox views: the first five are chips (what needs a person), the rest are history. */
const VIEWS = {
  needs: { status: 'open', label: 'quality.needsAction' },
  invalid: { status: 'open', kind: 'invalid', label: 'quality.invalid' },
  approval: { status: 'open', kind: 'approval', label: 'quality.approval' },
  flag: { status: 'open', kind: 'flag', label: 'quality.flagged' },
  fixed: { status: 'fixed', label: 'quality.fixedChip' },
  approved: { status: 'approved', label: 'quality.status.approved' },
  replayed: { status: 'replayed', label: 'quality.status.replayed' },
  dismissed: { status: 'dismissed', label: 'quality.status.dismissed' },
  superseded: { status: 'superseded', label: 'quality.superseded' },
} as const satisfies Record<string, { status: Status; kind?: Kind; label: MessageKey }>
type View = keyof typeof VIEWS
const CHIPS: View[] = ['needs', 'invalid', 'approval', 'flag', 'fixed']
const HISTORY: View[] = ['approved', 'replayed', 'dismissed', 'superseded']

const show = (v: unknown) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v))
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Fields a check complained about: the row's keys named in its messages. */
function failingFields(item: Item) {
  const text = item.messages.join(' ').toLowerCase()
  return Object.keys(item.fixedRow ?? item.row).filter((k) => new RegExp(`(^|[^a-z0-9_])${escape(k.toLowerCase())}([^a-z0-9_]|$)`).test(text))
}

export default function DataQualityLayer() {
  const { t, locale, formatDateTime, formatNumber } = usePrefs()
  const say = (m: string) => localizeCheck(m, locale)
  const toast = useToast()
  const [confirm, confirmEl] = useConfirm()
  const [overview, setOverview] = useState<Overview | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [view, setView] = useState<View>('needs')
  const [pipelineId, setPipelineId] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [fixing, setFixing] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [bulkField, setBulkField] = useState('')
  const [bulkValue, setBulkValue] = useState('')
  const canPreview = useCan('data:preview')
  const canManage = useCan('quality:manage')
  const when = (v: Date | string) => `${formatDateTime(v, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', dateStyle: undefined, timeStyle: undefined })} WIB`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const v = VIEWS[view] as { status: Status; kind?: Kind }
      const [ov, inbox] = await Promise.all([getQualityOverview(), canPreview ? listQuarantine({ status: v.status, kind: v.kind, pipelineId: pipelineId || undefined }) : Promise.resolve({ rows: [], total: 0 })])
      setOverview(ov)
      // What a person must act on first: failed checks, then approvals, then flags (already written).
      const rank = { invalid: 0, approval: 1, flag: 2 } as Record<string, number>
      setItems([...inbox.rows].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3)))
      setTotal(inbox.total)
      setSelected(new Set())
      setError('')
      return inbox.rows.length ? inbox.rows : []
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
      return null
    } finally {
      setLoading(false)
    }
  }, [view, pipelineId, canPreview, t])

  useEffect(() => {
    void load()
  }, [load])

  const counts: Record<View, number | null> = {
    needs: overview?.open.total ?? null,
    invalid: overview?.open.invalid ?? null,
    approval: overview?.open.approval ?? null,
    flag: overview?.open.flag ?? null,
    fixed: overview?.fixed ?? null,
    approved: null,
    replayed: null,
    dismissed: null,
    superseded: null,
  }

  const fields = useMemo(() => Array.from(new Set(items.filter((i) => selected.has(i.id)).flatMap((i) => Object.keys(i.fixedRow ?? i.row)))), [items, selected])
  const ids = [...selected]
  const destinationOf = (item: Item) => (item.destinations.length ? item.destinations.join(', ') : t('quality.someDestination'))

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setError('')
    try {
      const message = await fn()
      if (message) toast({ message })
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setBusy(false)
    }
  }

  const replayMessage = (res: Awaited<ReturnType<typeof replayRows>>) =>
    res.map((r) => (r.status === 'queued' ? t('quality.replayQueued', { count: r.rows, run: r.runId.slice(-6) }) : t('quality.replaySkipped', { count: r.rows, reason: r.message }))).join(' ')

  const dismiss = async (rowIds: string[]) => {
    if (!(await confirm({ title: t('quality.dismissTitle', { count: rowIds.length }), description: t('quality.dismissBody'), confirmLabel: t('quality.dismiss'), tone: 'danger' }))) return
    await act(async () => {
      const res = await dismissRows(rowIds)
      toast({
        message: t('quality.dismissedN', { count: res.dismissed }),
        action: {
          label: t('common.undo'),
          onClick: () =>
            void act(async () => {
              const back = await restoreRows(rowIds)
              return t('quality.restoredN', { count: back.restored })
            }),
        },
      })
    })
  }

  const approveAndReplay = async (item: Item) => {
    if (!(await confirm({ title: t('quality.approveTitle', { destination: destinationOf(item) }), description: t('quality.approveBody'), confirmLabel: t('quality.approveReplay') }))) return
    await act(async () => {
      await approveRows([item.id])
      return replayMessage(await replayRows([item.id]))
    })
  }

  const meta = overview
    ? [
        t('quality.summaryOpen', { count: formatNumber(overview.open.total) }),
        overview.open.invalid ? t('quality.summaryInvalid', { count: formatNumber(overview.open.invalid) }) : null,
        overview.open.approval ? t('quality.summaryApproval', { count: formatNumber(overview.open.approval) }) : null,
        overview.open.flag ? t('quality.summaryFlag', { count: formatNumber(overview.open.flag) }) : null,
        overview.fixed ? t('quality.summaryFixed', { count: formatNumber(overview.fixed) }) : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : undefined

  const selectBox = (i: Item) => (
    <input
      type="checkbox"
      className="mt-0.5 size-4 accent-[var(--primary)]"
      aria-label={t('quality.selectRow', { pipeline: i.pipelineName })}
      checked={selected.has(i.id)}
      onChange={(e) => {
        const next = new Set(selected)
        if (e.target.checked) next.add(i.id)
        else next.delete(i.id)
        setSelected(next)
      }}
    />
  )

  const problem = (i: Item) => {
    const tone = i.kind === 'flag' ? 'text-warning-text' : i.kind === 'approval' ? 'text-held-text' : 'text-danger-text'
    return (
      <div>
        <div className={cn('flex items-start gap-2 font-medium', tone)}>
          <Breaker state={i.kind === 'approval' ? 'held' : i.kind === 'flag' ? 'paused' : 'tripped'} className="mt-1" />
          <span>
            {i.kind === 'approval' ? t('quality.approval') : i.kind === 'flag' ? t('quality.flagKind', { severity: i.severity ?? '' }) : t('quality.invalid')}
            {i.fixedRow && <span className="ml-2 rounded-sm bg-live-soft px-1.5 py-px text-xs font-medium text-live-text">{t('quality.fixedBadge')}</span>}
          </span>
        </div>
        <p className="mt-0.5 pl-[18px] text-sm text-pretty">{i.messages.map(say).join('; ')}</p>
        {i.replayRunId && <p className="mt-0.5 pl-[18px] font-mono text-xs text-muted-foreground">{t('quality.replayStatus', { run: i.replayRunId.slice(-6) })}</p>}
      </div>
    )
  }

  /** Row values, failing fields first (in danger ink), up to `limit`. */
  const fieldsOf = (i: Item, limit: number) => {
    const row = (i.fixedRow ?? i.row) as Record<string, unknown>
    const failing = failingFields(i)
    const ordered = [...failing, ...Object.keys(row).filter((k) => !failing.includes(k))].slice(0, limit)
    return (
      <>
        {ordered.map((k) => (
          <span key={k} className={cn('mr-2 inline-block max-w-full break-all', failing.includes(k) ? 'text-danger-text' : 'text-muted-foreground')}>
            {k}: <span className={failing.includes(k) ? 'font-medium underline decoration-dotted underline-offset-2' : 'text-foreground'}>{show(row[k]) || '∅'}</span>
          </span>
        ))}
        {Object.keys(row).length > ordered.length && <span className="text-muted-foreground">…</span>}
      </>
    )
  }

  const actionsOf = (i: Item, index: number) =>
    canManage && (status === 'open' || status === 'fixed') ? (
      <span className="inline-flex gap-1.5">
        {i.kind === 'approval' && status === 'open' ? (
          <Button size="sm" variant="outline" onClick={() => void approveAndReplay(i)} disabled={busy} aria-label={`${t('quality.approve')} · ${i.messages[0] ? say(i.messages[0]) : i.pipelineName}`}>
            <CheckCheck /> {t('quality.approve')}
          </Button>
        ) : i.kind !== 'flag' ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setFixing(index)}
            disabled={!i.editable}
            title={i.editable ? undefined : t('quality.maskedNoEdit')}
            aria-label={`${t('quality.fix')} · ${i.messages[0] ? say(i.messages[0]) : i.pipelineName}`}
          >
            <Wrench /> {t('quality.fix')}
          </Button>
        ) : null}
        <Button size="icon-sm" variant="ghost" onClick={() => void dismiss([i.id])} disabled={busy} aria-label={`${t('quality.dismiss')} · ${i.messages[0] ? say(i.messages[0]) : i.pipelineName}`}>
          <X />
        </Button>
      </span>
    ) : null

  const current = fixing !== null ? items[fixing] : null
  const status = VIEWS[view].status

  return (
    <div>
      {confirmEl}
      {current && (
        <FixDialog
          key={current.id}
          item={current}
          index={fixing!}
          total={items.length}
          destination={destinationOf(current)}
          onClose={() => setFixing(null)}
          onMove={(delta) => setFixing((i) => (i === null ? null : Math.min(Math.max(i + delta, 0), items.length - 1)))}
          onSaved={async (message) => {
            toast({ message })
            const at = fixing!
            const rows = await load()
            // Fix-and-next: the next row slides into the same position.
            if (!rows?.length) setFixing(null)
            else setFixing(Math.min(at, rows.length - 1))
          }}
        />
      )}

      <PageHeader title={t('pages.quality.title')} description={t('pages.quality.description')} meta={meta} />

      <div className="space-y-5">
        <section data-tour="quality-inbox" aria-labelledby="inbox-title" className="rounded-lg border border-border bg-card">
          <h2 id="inbox-title" className="sr-only">
            {t('quality.inbox')}
          </h2>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
            <div role="group" aria-label={t('quality.filters')} className="flex flex-wrap gap-1.5">
              {CHIPS.map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-sm border px-3 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    view === v ? 'border-live bg-accent font-medium text-accent-foreground shadow-[inset_0_-2px_0_var(--live)]' : 'border-border bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {t(VIEWS[v].label)}
                  {counts[v] !== null && <span className="font-mono text-xs text-muted-foreground">{formatNumber(counts[v]!)}</span>}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {t('quality.history')}
                <select className={nativeSelectClass} value={HISTORY.includes(view) ? view : ''} onChange={(e) => e.target.value && setView(e.target.value as View)}>
                  <option value="">{t('quality.historyNone')}</option>
                  {HISTORY.map((v) => (
                    <option key={v} value={v}>
                      {t(VIEWS[v].label)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                {t('quality.pipelineFilter')}
                <select className={cn(nativeSelectClass, 'max-w-52')} value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                  <option value="">{t('quality.allPipelines')}</option>
                  {(overview?.pipelines ?? []).map((p) => (
                    <option key={p.pipelineId} value={p.pipelineId}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="icon-sm" variant="ghost" onClick={() => void load()} aria-label={t('common.refresh')}>
                <RefreshCw className={cn(loading && 'animate-spin')} />
              </Button>
            </div>
          </div>

          {canManage && selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent/60 px-4 py-2.5 text-sm" role="region" aria-label={t('common.selected', { count: selected.size })}>
              <span className="font-medium">{t('common.selected', { count: selected.size })}</span>
              <span className="mx-1 h-4 w-px bg-border" aria-hidden />
              <span className="text-muted-foreground">{t('quality.bulkSet')}</span>
              <select className={nativeSelectClass} value={bulkField} onChange={(e) => setBulkField(e.target.value)} aria-label={t('quality.bulkField')}>
                <option value="">{t('quality.bulkFieldPlaceholder')}</option>
                {fields.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <span className="text-muted-foreground">{t('quality.bulkTo')}</span>
              <Input className="h-8 w-44 bg-card" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)} placeholder={t('quality.bulkValue')} aria-label={t('quality.bulkValue')} />
              <Button size="sm" variant="outline" disabled={busy || !bulkField} onClick={() => void act(async () => t('quality.bulkUpdated', { count: (await bulkFix({ ids, field: bulkField, value: bulkValue })).updated }))}>
                <Wrench /> {t('quality.bulkFix')}
              </Button>
              {(view === 'needs' || view === 'approval') && (
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => t('quality.approvedN', { count: (await approveRows(ids)).approved }))}>
                  <CheckCheck /> {t('quality.approve')}
                </Button>
              )}
              {(status === 'fixed' || status === 'approved') && (
                <Button size="sm" disabled={busy} onClick={() => void act(async () => replayMessage(await replayRows(ids)))}>
                  <Play /> {t('quality.replay')}
                </Button>
              )}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void dismiss(ids)}>
                <X /> {t('quality.dismiss')}
              </Button>
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            </div>
          )}
          {status === 'superseded' && (
            <p className="border-b border-border px-4 py-2.5 text-xs text-muted-foreground">{t('quality.supersededNote')}</p>
          )}
          {error && (
            <div className="border-b border-border p-3">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}

          {!canPreview ? (
            <p className="p-6 text-sm text-muted-foreground">{t('quality.noRowAccess')}</p>
          ) : loading && items.length === 0 ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          ) : items.length === 0 ? (
            view === 'needs' && !pipelineId ? (
              <EmptyState icon={<ShieldCheck />} title={t('quality.emptyTitle')}>
                {t('quality.emptyBody')}
              </EmptyState>
            ) : (
              <EmptyState compact title={t('quality.emptyFiltered')} />
            )
          ) : (
            <>
              <ul className="divide-y divide-border md:hidden" aria-label={t('quality.inbox')}>
                {items.map((i, index) => (
                  <li key={i.id} className={cn('flex gap-3 px-4 py-3', selected.has(i.id) && 'bg-accent')}>
                    {canManage && <div className="pt-0.5">{selectBox(i)}</div>}
                    <div className="min-w-0 flex-1 space-y-1.5">
                      {problem(i)}
                      <div className="font-mono text-xs leading-5 break-words">{fieldsOf(i, 3)}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.pipelineName} · {localizeStepTitle(i.step, t)} · <span className="font-mono">{when(i.createdAt)}</span>
                      </div>
                      {actionsOf(i, index)}
                    </div>
                  </li>
                ))}
              </ul>
              <div className="hidden md:block">
              <Table label={t('quality.inbox')} className="min-w-[860px]">
                <THead>
                  <tr>
                    {canManage && (
                      <Th className="w-10">
                        <input
                          type="checkbox"
                          className="size-4 accent-[var(--primary)]"
                          aria-label={t('quality.selectAll')}
                          checked={selected.size === items.length}
                          onChange={(e) => setSelected(e.target.checked ? new Set(items.map((i) => i.id)) : new Set())}
                        />
                      </Th>
                    )}
                    <Th>{t('quality.colProblem')}</Th>
                    <Th>{t('quality.colRow')}</Th>
                    <Th>{t('quality.colWhere')}</Th>
                    <Th>{t('quality.colWhen')}</Th>
                    <Th className="text-right">
                      <span className="sr-only">{t('common.edit')}</span>
                    </Th>
                  </tr>
                </THead>
                <TBody>
                  {items.map((i, index) => (
                    <Tr key={i.id} selected={selected.has(i.id)} className="align-top">
                      {canManage && <Td>{selectBox(i)}</Td>}
                      <Td className="max-w-sm">{problem(i)}</Td>
                      <Td className="max-w-md font-mono text-xs leading-5">{fieldsOf(i, 6)}</Td>
                      <Td className="text-xs">
                        <div className="font-medium">{i.pipelineName}</div>
                        <div className="text-muted-foreground">{localizeStepTitle(i.step, t)}</div>
                      </Td>
                      <Td className="font-mono text-xs whitespace-nowrap text-muted-foreground">{when(i.createdAt)}</Td>
                      <Td className="text-right whitespace-nowrap">{actionsOf(i, index)}</Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
              </div>
              {total > items.length && <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">{t('quality.showing', { shown: items.length, total: formatNumber(total) })}</p>}
            </>
          )}
        </section>

        {overview && (
          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <section aria-labelledby="score-title" className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 id="score-title" className="text-base font-semibold">
                  {t('quality.scoreTitle')}
                </h2>
                <p className="text-sm text-muted-foreground">{t('quality.scoreBody')}</p>
              </div>
              {overview.pipelines.length === 0 ? (
                <EmptyState compact title={t('quality.noRuns')} />
              ) : (
                <Table label={t('quality.scoreTitle')}>
                  <THead>
                    <tr>
                      <Th>{t('quality.colPipeline')}</Th>
                      <Th className="w-44">{t('quality.colScore')}</Th>
                      <Th className="text-right">{t('quality.colRead')}</Th>
                      <Th className="hidden text-right sm:table-cell">{t('quality.colHeld')}</Th>
                      <Th className="hidden text-right md:table-cell">{t('quality.colFlagged')}</Th>
                      <Th className="hidden text-right md:table-cell">{t('quality.colFailedRuns')}</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {overview.pipelines.map((p) => (
                      <Tr key={p.pipelineId}>
                        <Td>
                          <div className="font-medium">{p.name}</div>
                          {p.datasets.length > 0 && <div className="font-mono text-xs text-muted-foreground">→ {p.datasets.join(', ')}</div>}
                        </Td>
                        <Td>
                          {p.score === null ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 flex-1 bg-muted" aria-hidden>
                                <div className={cn('h-full', p.score >= 98 ? 'bg-live' : p.score >= 90 ? 'bg-warning' : 'bg-danger')} style={{ width: `${p.score}%` }} />
                              </div>
                              <span className="w-14 text-right font-mono text-xs">{p.score}%</span>
                            </div>
                          )}
                        </Td>
                        <Td className="text-right font-mono text-xs">{formatNumber(p.read)}</Td>
                        <Td className={cn('hidden text-right font-mono text-xs sm:table-cell', p.quarantined > 0 && 'text-danger-text')}>{formatNumber(p.quarantined)}</Td>
                        <Td className="hidden text-right font-mono text-xs md:table-cell">{formatNumber(p.flagged)}</Td>
                        <Td className="hidden text-right font-mono text-xs md:table-cell">{p.failed}</Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </section>

            <section aria-labelledby="problems-title" className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3">
                <h2 id="problems-title" className="text-base font-semibold">
                  {t('quality.commonProblems')}
                </h2>
              </div>
              {overview.topProblems.length === 0 ? (
                <EmptyState compact title={t('quality.noProblems')} />
              ) : (
                <Table label={t('quality.commonProblems')}>
                  <THead>
                    <tr>
                      <Th className="w-16 text-right">{t('quality.colCount')}</Th>
                      <Th>{t('quality.colMessage')}</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {overview.topProblems.map((p, i) => (
                      <Tr key={i} className="align-top">
                        <Td className="text-right font-mono text-xs text-danger-text">{formatNumber(p.n)}</Td>
                        <Td>
                          <div className="text-sm text-pretty">{p.message ? say(p.message) : t('quality.unknownProblem')}</div>
                          <div className="text-xs text-muted-foreground">{p.pipelineName}</div>
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Fix one held row: failing fields first, then the rest. "Save & replay" sends it on
 * (after naming the destination); the next row is already loaded behind it.
 */
function FixDialog({
  item,
  index,
  total,
  destination,
  onClose,
  onMove,
  onSaved,
}: {
  item: Item
  index: number
  total: number
  destination: string
  onClose: () => void
  onMove: (delta: number) => void
  onSaved: (message: string) => void | Promise<void>
}) {
  const { t, locale } = usePrefs()
  const [ask, askEl] = useConfirm()
  const original = (item.fixedRow ?? item.row) as Record<string, unknown>
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(original).map(([k, v]) => [k, show(v)])))
  const nulls = useMemo(() => new Set(Object.entries(original).filter(([, v]) => v === null || v === undefined).map(([k]) => k)), [original])
  const [saving, setSaving] = useState<'save' | 'replay' | null>(null)
  const [confirmReplay, setConfirmReplay] = useState(false)
  const [error, setError] = useState('')
  const failing = useMemo(() => failingFields(item), [item])
  const others = Object.keys(values).filter((k) => !failing.includes(k))
  const changed = (k: string) => show(original[k]) !== values[k]
  const dirty = Object.keys(values).some(changed)

  const payload = () => {
    const row: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(values)) {
      const before = original[k]
      // Keep the original type when the text is unchanged (numbers, booleans, objects).
      row[k] = nulls.has(k) && v === '' ? null : show(before) === v ? before : v
    }
    return row
  }

  const save = async (replay: boolean) => {
    setSaving(replay ? 'replay' : 'save')
    setError('')
    try {
      await fixRow({ id: item.id, row: payload() })
      if (replay) {
        const res = await replayRows([item.id])
        const queued = res.find((r) => r.status === 'queued')
        await onSaved(queued ? t('quality.replayQueued', { count: 1, run: queued.runId.slice(-6) }) : t('quality.replaySkipped', { count: 1, reason: res[0]?.message ?? '' }))
      } else {
        await onSaved(t('quality.saved'))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    } finally {
      setSaving(null)
      setConfirmReplay(false)
    }
  }

  const move = async (delta: number) => {
    if (dirty && !(await ask({ title: t('dialog.unsavedTitle'), description: t('dialog.unsavedBody'), confirmLabel: t('dialog.discard'), cancelLabel: t('dialog.keepEditing'), tone: 'danger' }))) return
    onMove(delta)
  }

  const field = (k: string, failingField: boolean) => (
    <div key={k}>
      <Label htmlFor={`fix-${item.id}-${k}`} className={cn('mb-1 flex items-center gap-2 font-mono text-xs', failingField ? 'text-danger-text' : 'text-muted-foreground')}>
        {k}
        {changed(k) && <span className="font-sans text-[11px] font-medium text-live-text">{t('quality.changed')}</span>}
      </Label>
      <Input
        id={`fix-${item.id}-${k}`}
        value={values[k]}
        placeholder={nulls.has(k) ? t('quality.nullPlaceholder') : ''}
        aria-invalid={failingField && !changed(k) ? true : undefined}
        onChange={(e) => setValues({ ...values, [k]: e.target.value })}
        className={cn('font-mono', changed(k) && 'border-live')}
      />
    </div>
  )

  return (
    <>
      {askEl}
      <Modal
        onClose={onClose}
        dirty={dirty}
        size="lg"
        title={t('quality.fixTitle', { pipeline: item.pipelineName })}
        description={`${t('quality.heldAt')}: ${localizeStepTitle(item.step, t)}`}
        footer={
          <>
            <div className="mr-auto flex items-center gap-1">
              <Button size="icon-sm" variant="ghost" disabled={index === 0 || saving !== null} onClick={() => void move(-1)} aria-label={t('quality.previousRow')}>
                <ChevronLeft />
              </Button>
              <span className="font-mono text-xs text-muted-foreground" aria-live="polite">
                {t('quality.position', { index: index + 1, total })}
              </span>
              <Button size="icon-sm" variant="ghost" disabled={index >= total - 1 || saving !== null} onClick={() => void move(1)} aria-label={t('quality.nextRow')}>
                <ChevronRight />
              </Button>
            </div>
            <Button variant="outline" disabled={saving !== null} onClick={() => void save(false)}>
              {saving === 'save' && <Loader2 className="animate-spin" />} {t('quality.saveOnly')}
            </Button>
            <Button disabled={saving !== null} onClick={() => setConfirmReplay(true)}>
              {saving === 'replay' ? <Loader2 className="animate-spin" /> : <Play />} {t('quality.saveReplay')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Notice tone="danger" title={t('quality.reason')} live={false}>
            {item.messages.map((m) => localizeCheck(m, locale)).join('; ')}
          </Notice>
          {error && <Notice tone="danger">{error}</Notice>}
          {failing.length > 0 && (
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">{t('quality.failing')}</legend>
              <div className="grid gap-3 sm:grid-cols-2">{failing.map((k) => field(k, true))}</div>
            </fieldset>
          )}
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{failing.length ? t('quality.otherFields') : t('quality.colRow')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">{others.map((k) => field(k, false))}</div>
          </fieldset>
          <p className="text-xs text-muted-foreground">{t('quality.saveHint')}</p>
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmReplay}
        onOpenChange={setConfirmReplay}
        title={t('quality.replayConfirm', { destination })}
        description={t('quality.replayBody')}
        confirmLabel={t('quality.saveReplay')}
        busy={saving === 'replay'}
        onConfirm={() => save(true)}
      />
    </>
  )
}
