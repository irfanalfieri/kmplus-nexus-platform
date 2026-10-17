'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, Loader2, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'
import { buttonVariants } from '@/components/ui/button'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Breaker, FlowLine, StateMark, type FlowState } from '@/components/ui/flow-line'
import { PageHeader } from '@/components/dashboard/page-header'
import { UpgradeBanner } from '@/components/upgrades/upgrade-banner'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useWorkspace } from '@/components/workspace/workspace-context'
import { getOverview } from '@/lib/actions/monitoring'
import { listPipelines } from '@/lib/actions/pipelines'
import { definitionSchema } from '@/lib/pipelines/definition'
import { ends, lineState, type PipelineRow } from '@/components/pipelines/line-state'
import type { MessageKey } from '@/lib/i18n/translate'

type Overview = Awaited<ReturnType<typeof getOverview>>

const STATE_RANK: Record<FlowState, number> = { tripped: 0, held: 1, running: 2, paused: 3, idle: 4, live: 5 }
const LINES_SHOWN = 8

/**
 * The workspace as a mimic panel: every pipeline as a line (tripped first),
 * what needs a person, what runs next, and a one-line readout of the last 24 h.
 */
export default function OverviewLayer() {
  const { t, formatDateTime, formatNumber } = usePrefs()
  const { user } = useWorkspace()
  const [data, setData] = useState<Overview | null>(null)
  const [pipes, setPipes] = useState<PipelineRow[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [ov, rows] = await Promise.all([getOverview(), listPipelines()])
      setData(ov)
      setPipes(rows)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('overview.loadFailed'))
    }
  }, [t])

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => clearInterval(timer)
  }, [load])

  const sourceName = useCallback((id: string) => data?.sourceList.find((s) => s.id === id)?.name ?? '—', [data])
  const lines = useMemo(
    () =>
      pipes
        .map((p) => {
          const def = definitionSchema.safeParse(p.config)
          return { p, ...ends(def.success ? def.data : null, sourceName, t), line: lineState(p, false, t) }
        })
        .sort((a, b) => STATE_RANK[a.line.state] - STATE_RANK[b.line.state] || a.p.name.localeCompare(b.p.name)),
    [pipes, sourceName, t],
  )
  const upcoming = useMemo(
    () =>
      pipes
        .filter((p) => p.enabled && p.nextRunAt)
        .sort((a, b) => new Date(a.nextRunAt!).getTime() - new Date(b.nextRunAt!).getTime())
        .slice(0, 5),
    [pipes],
  )

  const firstName = (user.name || user.email).split(/[\s@]/)[0]
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Jakarta' }).format(new Date()))
  const greeting = t(hour < 11 ? 'overview.greeting.morning' : hour < 18 ? 'overview.greeting.afternoon' : 'overview.greeting.evening', { name: firstName })
  const when = (v: Date | string) => `${formatDateTime(v, { weekday: 'short', hour: '2-digit', minute: '2-digit', dateStyle: undefined, timeStyle: undefined })} WIB`

  if (!data) {
    return (
      <div>
        <PageHeader title={greeting} description={t('pages.overview.description')} />
      <UpgradeBanner screen="overview" />
        {error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        )}
      </div>
    )
  }

  // What needs a person, most urgent first. Each item names the thing and links to where it is fixed.
  const needs: { state: FlowState; text: string; href: string; action: MessageKey }[] = []
  if (data.held.invalid) needs.push({ state: 'tripped', text: t('overview.needs.held', { count: formatNumber(data.held.invalid) }), href: '/dashboard/quality?view=invalid', action: 'overview.needs.review' })
  if (data.held.approval) needs.push({ state: 'held', text: t('overview.needs.approvalRows', { count: formatNumber(data.held.approval) }), href: '/dashboard/quality?view=approval', action: 'overview.needs.review' })
  if (data.approvalsPending) needs.push({ state: 'held', text: t('overview.needs.approvals', { count: data.approvalsPending }), href: '/dashboard/pipelines?approvals=1', action: 'overview.needs.review' })
  for (const a of data.attention) {
    needs.push({ state: 'tripped', text: t(a.lastRunStatus === 'failed' ? 'overview.needs.failed' : 'overview.needs.partial', { name: a.name }), href: `/dashboard/pipelines?history=${encodeURIComponent(a.id)}`, action: 'overview.needs.open' })
  }
  for (const s of data.sourceList.filter((x) => x.status !== 'connected')) {
    needs.push({ state: 'idle', text: t('overview.needs.source', { name: s.name }), href: `/dashboard/sources?source=${encodeURIComponent(s.id)}&open=health`, action: 'overview.needs.check' })
  }
  if (data.held.flag) needs.push({ state: 'paused', text: t('overview.needs.flagged', { count: formatNumber(data.held.flag) }), href: '/dashboard/quality?view=flag', action: 'overview.needs.review' })

  const setupLeft = data.checklist.filter((c) => !c.done).length
  const readout: { label: string; state?: FlowState }[] = [
    { label: t('overview.readout.runs', { count: data.last24h.runs }) },
    { label: t('overview.readout.failed', { count: data.last24h.failed }), state: data.last24h.failed ? 'tripped' : undefined },
    { label: t('overview.readout.written', { count: formatNumber(data.last24h.written) }) },
    { label: t('overview.readout.held', { count: formatNumber(data.held.total) }), state: data.held.total ? 'tripped' : undefined },
    { label: t('overview.readout.datasets', { count: data.datasets.count }) },
  ]

  return (
    <div>
      <PageHeader title={greeting} description={t('pages.overview.description')} />
      <UpgradeBanner screen="overview" />

      <div className="space-y-5">
        {error && <Notice tone="danger">{error}</Notice>}

        <section aria-label={t('overview.readout.label')} className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border border-border bg-card px-4 py-3">
          <h2 className="font-mono text-[11px] font-medium tracking-[0.08em] text-muted-foreground uppercase">{t('overview.readout.label')}</h2>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 font-mono text-[13px]">
            {readout.map((r) => (
              <li key={r.label} className={cn('flex items-center gap-2', r.state === 'tripped' && 'text-danger-text')}>
                {r.state && <Breaker state={r.state} />}
                {r.label}
              </li>
            ))}
          </ul>
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section data-tour="overview-lines" aria-labelledby="lines-title" className="rounded-lg border border-border bg-card">
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1 border-b border-border px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id="lines-title" className="text-base font-semibold">
                  {t('overview.lines.title')}
                </h2>
                <p className="text-sm text-muted-foreground">{t('overview.lines.body')}</p>
              </div>
              <Link href="/dashboard/pipelines" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                {t('overview.lines.openPipelines')} <ArrowRight />
              </Link>
            </div>
            {lines.length === 0 ? (
              <EmptyState
                icon={<Workflow />}
                title={t('overview.lines.empty')}
                action={
                  <Link href="/dashboard/pipelines" className={buttonVariants()}>
                    {t('pipelines.new')}
                  </Link>
                }
              >
                {t('overview.lines.emptyBody')}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {lines.slice(0, LINES_SHOWN).map(({ p, from, table, to, line }) => (
                  <li key={p.id}>
                    <Link
                      href={p.heldRows > 0 ? `/dashboard/quality?pipeline=${encodeURIComponent(p.id)}` : `/dashboard/pipelines?history=${encodeURIComponent(p.id)}`}
                      className="grid gap-x-4 gap-y-1.5 px-4 py-3 outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring sm:grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)_auto] sm:items-center"
                    >
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{p.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">{p.lastRunAt ? when(p.lastRunAt) : t('state.neverRun')}</span>
                      </span>
                      <FlowLine from={from} to={to} state={line.state} srLabel={t('pipelines.flowLabel', { from: table ? `${from} · ${table}` : from, to })} />
                      <StateMark state={line.state} className="sm:justify-self-end">
                        {line.label}
                      </StateMark>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            {lines.length > LINES_SHOWN && (
              <p className="border-t border-border px-4 py-2.5 text-sm">
                <Link href="/dashboard/pipelines" className="text-info-text hover:underline">
                  {t('overview.lines.more', { count: lines.length - LINES_SHOWN })}
                </Link>
              </p>
            )}
          </section>

          <div className="space-y-5">
            {setupLeft > 0 && (
              <section aria-labelledby="setup-title" className="rounded-lg border border-border bg-card">
                <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3">
                  <h2 id="setup-title" className="text-base font-semibold">
                    {t('overview.setup.title')}
                  </h2>
                  <span className="font-mono text-xs text-muted-foreground">{t('overview.setup.progress', { done: data.checklist.length - setupLeft, total: data.checklist.length })}</span>
                </div>
                <ol className="divide-y divide-border">
                  {data.checklist.map((c) => (
                    <li key={c.key}>
                      <Link href={`/dashboard/${c.tab}`} className="flex items-center gap-3 px-4 py-2.5 text-sm outline-none hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring">
                        <Breaker state={c.done ? 'live' : 'idle'} />
                        <span className={cn('flex-1', c.done && 'text-muted-foreground line-through decoration-1')}>{t(`overview.setup.${c.key as 'connector' | 'source' | 'pipeline' | 'run' | 'schedule'}`)}</span>
                        <span className="sr-only">{c.done ? t('overview.setup.done') : t('overview.setup.todo')}</span>
                        {!c.done && <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
                      </Link>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section data-tour="overview-needs" aria-labelledby="needs-title" className="rounded-lg border border-border bg-card">
              <h2 id="needs-title" className="border-b border-border px-4 py-3 text-base font-semibold">
                {t('overview.needs.title')}
              </h2>
              {needs.length === 0 ? (
                <div className="flex items-start gap-3 px-4 py-4">
                  <Breaker state="live" className="mt-1" />
                  <div>
                    <p className="text-sm font-medium text-live-text">{t('overview.needs.clear')}</p>
                    <p className="text-sm text-muted-foreground">{t('overview.needs.clearBody')}</p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {needs.map((n, i) => (
                    <li key={i} className="flex items-start gap-3 px-4 py-3">
                      <Breaker state={n.state} className="mt-1" />
                      <span className="min-w-0 flex-1 text-sm text-pretty">{n.text}</span>
                      <Link href={n.href} className="shrink-0 text-sm font-medium text-info-text hover:underline">
                        {t(n.action)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="next-title" className="rounded-lg border border-border bg-card">
              <h2 id="next-title" className="border-b border-border px-4 py-3 text-base font-semibold">
                {t('overview.next.title')}
              </h2>
              {upcoming.length === 0 ? (
                <p className="px-4 py-4 text-sm text-muted-foreground">{t('overview.next.empty')}</p>
              ) : (
                <ol className="divide-y divide-border">
                  {upcoming.map((p) => (
                    <li key={p.id} className="flex items-baseline gap-3 px-4 py-2.5 text-sm">
                      <time dateTime={new Date(p.nextRunAt!).toISOString()} className="w-32 shrink-0 font-mono text-xs text-muted-foreground">
                        {when(p.nextRunAt!)}
                      </time>
                      <span className="min-w-0 truncate">{p.name}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
