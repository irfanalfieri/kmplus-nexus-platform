'use client'

import { ActiveMaintenanceNotice, MaintenanceWindowsDialog } from '@/components/pipelines/maintenance-windows'
import { PipelineAlertsDialog } from '@/components/pipelines/pipeline-alerts'
import { ImportPipelineDialog, downloadPipelineExport } from '@/components/pipelines/pipeline-import'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowUpRight, BellRing, CalendarOff, ClipboardCheck, Edit, Eye, FileDown, FileUp, History, Loader2, Lock, MoreHorizontal, Pause, Play, Plus, Rocket, RotateCcw, Search, Trash2, Undo2, Workflow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice, type NoticeTone } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { ConfirmDialog, Modal, useConfirm } from '@/components/ui/dialog'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { FlowLine, StateMark, type FlowState } from '@/components/ui/flow-line'
import { useToast } from '@/components/ui/toast'
import { deletePipeline, discardDraft, getBuilderOptions, publishPipeline, getDatasetPreview, getRunStatus, listPipelines, resetSyncPosition, runPipelineNow, setPipelineEnabled } from '@/lib/actions/pipelines'
import { DEFAULT_SCHEDULE, DEFAULT_SETTINGS, definitionSchema, scheduleSchema, topoOrder, type PipelineDefinition } from '@/lib/pipelines/definition'
import { lanePlan } from '@/lib/pipelines/lanes'
import { describeScheduleT } from '@/lib/pipelines/schedule'
import PipelineEditor, { blankPipeline, SampleTable, type EditablePipeline } from '@/components/pipelines/pipeline-editor'
import TemplatePicker from '@/components/pipelines/template-picker'
import RunHistory from '@/components/pipelines/run-history'
import type { BuilderOptions } from '@/components/pipelines/step-editors'
import { NOTIFICATIONS_CHANGED } from '@/components/dashboard/notification-bell'
import { PageHeader } from '@/components/dashboard/page-header'
import { useCan, useWorkspace } from '@/components/workspace/workspace-context'
import { EnvironmentBadge } from '@/components/workspace/environment-badge'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { Translate } from '@/lib/i18n/translate'
import ApprovalsPanel from '@/components/pipelines/approvals-panel'
import PromoteDialog from '@/components/pipelines/promote-dialog'
import { listPromotionStatus } from '@/lib/actions/environments'
import { ENVIRONMENT_INFO, isEnvironment } from '@/lib/pipelines/promote'

import { ends, lineState, type PipelineRow } from '@/components/pipelines/line-state'
import { useHashTarget, useUrlIntents } from '@/components/dashboard/url-intents'

function toEditable(p: PipelineRow): EditablePipeline {
  // Edit the unpublished draft when there is one, else the published definition.
  const def = definitionSchema.safeParse(p.draftConfig ?? p.config)
  const blank = blankPipeline()
  return {
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    enabled: p.enabled ?? false,
    schedule: scheduleSchema.safeParse(p.schedule ?? {}).data ?? DEFAULT_SCHEDULE,
    nodes: def.success ? def.data.nodes : blank.nodes,
    edges: def.success ? def.data.edges : blank.edges,
    settings: def.success ? def.data.settings : DEFAULT_SETTINGS,
    syncPosition: p.syncPosition,
    publishedVersion: p.version ?? 0,
    draftVersion: p.draftVersion,
    webhookTrigger: p.webhookTrigger,
  }
}


export default function PipelineDesignerLayer() {
  const { t, formatDateTime, formatNumber } = usePrefs()
  const toast = useToast()
  const [confirm, confirmEl] = useConfirm()
  const [items, setItems] = useState<PipelineRow[]>([])
  const [options, setOptions] = useState<BuilderOptions>({ dataSources: [], datasets: [], rules: [], pipelines: [], mappingTemplates: [], classifiedColumns: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ id: string; tone: NoticeTone; text: string } | null>(null)
  const [editing, setEditing] = useState<EditablePipeline | null>(null)
  const [importing, setImporting] = useState(false)
  const [maintenance, setMaintenance] = useState(false)
  const [alertsFor, setAlertsFor] = useState<PipelineRow | null>(null)
  const [maintenanceKey, setMaintenanceKey] = useState(0)
  const [picking, setPicking] = useState(false)
  const [historyFor, setHistoryFor] = useState<PipelineRow | null>(null)
  const [running, setRunning] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<PipelineRow | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)
  const [preview, setPreview] = useState<{ name: string; rows: Record<string, unknown>[] } | null>(null)
  const [query, setQuery] = useState('')
  const canEdit = useCan('pipelines:edit')
  const { workspace } = useWorkspace()
  // Locked environments (Production) change only by promotion (GV-7).
  const editable = canEdit && !workspace.locked
  const [promoting, setPromoting] = useState<string | null>(null)
  const [deployed, setDeployed] = useState<Record<string, { environment: string | null; version: number | null }[]>>({})
  const [approvalsKey, setApprovalsKey] = useState(0)
  const [approvalHistory, setApprovalHistory] = useState(false)
  const canRun = useCan('pipelines:run')
  const canPreview = useCan('data:preview')

  const when = useCallback(
    (value: Date | string | null | undefined) => (value ? `${formatDateTime(value, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', dateStyle: undefined, timeStyle: undefined })} WIB` : '—'),
    [formatDateTime],
  )
  // execution_logs.duration is whole seconds.
  const duration = (s: number | null | undefined) => {
    if (s == null) return ''
    return s < 60 ? t('pipelines.dur', { value: s < 1 ? '<1' : s }) : t('pipelines.durMin', { min: Math.floor(s / 60), sec: s % 60 })
  }

  const load = useCallback(async () => {
    try {
      const [rows, opts, promo] = await Promise.all([listPipelines(), getBuilderOptions(), workspace.environment ? listPromotionStatus().catch(() => []) : Promise.resolve([])])
      setItems(rows)
      setOptions(opts)
      setDeployed(Object.fromEntries(promo.map((x) => [x.pipelineId, x.deployed])))
      setApprovalsKey((k) => k + 1)
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [workspace.environment, t])

  useEffect(() => {
    void load()
  }, [load])

  const sourceName = useCallback((id: string) => options.dataSources.find((d) => d.id === id)?.name ?? '—', [options])

  const rows = useMemo(
    () =>
      items.map((p) => {
        const def = definitionSchema.safeParse(p.config)
        return { p, def: def.success ? def.data : null, ...ends(def.success ? def.data : null, sourceName, t), line: lineState(p, running === p.id, t) }
      }),
    [items, sourceName, running, t],
  )
  const q = query.trim().toLowerCase()
  const visible = q ? rows.filter((r) => [r.p.name, r.p.description ?? '', r.from, r.to].some((s) => s.toLowerCase().includes(q))) : rows

  const summary = useMemo(() => {
    const scheduled = items.filter((p) => p.enabled && p.nextRunAt).length
    const attention = rows.filter((r) => r.line.state === 'tripped' || r.line.state === 'held').length
    const last = items.map((p) => p.lastRunAt).filter(Boolean).sort().at(-1)
    return [t('pipelines.summary', { count: items.length }), t('pipelines.statScheduled', { count: scheduled }), attention ? t('pipelines.statAttention', { count: attention }) : null, last ? t('pipelines.lastRunAt', { when: when(last) }) : null]
      .filter(Boolean)
      .join(' · ')
  }, [items, rows, t, when])

  /** Runs execute in the background worker; poll the run until it finishes. */
  const run = async (p: PipelineRow) => {
    setRunning(p.id)
    setNotice(null)
    try {
      const outcome = await runPipelineNow(p.id)
      if (outcome.status === 'skipped') {
        setNotice({ id: p.id, tone: 'warning', text: outcome.message })
        return
      }
      setNotice({ id: p.id, tone: 'info', text: t('pipelines.runQueued') })
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000))
        const s = await getRunStatus(outcome.runId)
        if (s.active) {
          const progress = s.recordsProcessed ? t('pipelines.progressRows', { read: formatNumber(s.recordsProcessed), written: formatNumber(s.recordsSuccess ?? 0) }) : t('pipelines.starting')
          setNotice({ id: p.id, tone: 'info', text: `${t('pipelines.runProgress', { status: s.status === 'queued' ? t('state.queued') : t('state.running'), progress })}${s.errorMessage ? ` · ${s.errorMessage}` : ''}` })
          continue
        }
        const vars = { written: formatNumber(s.recordsSuccess ?? 0), read: formatNumber(s.recordsProcessed ?? 0), rejected: formatNumber(s.recordsError ?? 0) }
        const result = s.recordsError ? t('pipelines.runSummaryRejected', vars) : t('pipelines.runSummary', vars)
        setNotice({
          id: p.id,
          tone: s.status === 'success' ? 'success' : s.status === 'failed' ? 'danger' : 'warning',
          text:
            s.status === 'failed'
              ? t('pipelines.runFailed', { error: s.errorMessage ?? t('pipelines.unknownError') })
              : s.status === 'cancelled'
                ? t('pipelines.runCancelled', { summary: result })
                : t('pipelines.runFinished', { summary: result }),
        })
        break
      }
      await load()
    } catch (err) {
      setNotice({ id: p.id, tone: 'danger', text: err instanceof Error ? err.message : t('common.somethingWrong') })
    } finally {
      setRunning(null)
      window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
    }
  }

  const attempt = async (p: PipelineRow, action: () => Promise<unknown>, done?: string) => {
    try {
      await action()
      if (done) toast({ message: done })
      await load()
    } catch (err) {
      setNotice({ id: p.id, tone: 'danger', text: err instanceof Error ? err.message : t('common.somethingWrong') })
    }
  }

  const toggle = (p: PipelineRow) => attempt(p, () => setPipelineEnabled(p.id, !p.enabled), p.enabled ? t('pipelines.paused') : t('pipelines.resumed'))

  const resetSync = async (p: PipelineRow) => {
    if (await confirm({ title: t('pipelines.resetTitle', { name: p.name }), description: t('pipelines.resetBody'), confirmLabel: t('pipelines.resetSync') }))
      await attempt(p, () => resetSyncPosition(p.id), t('pipelines.resetDone'))
  }

  const publish = async (p: PipelineRow) => {
    if (!(await confirm({ title: t('pipelines.publishTitle', { version: p.draftVersion ?? '', name: p.name }), description: t('pipelines.publishBody'), confirmLabel: t('pipelines.publishDraft') }))) return
    await attempt(p, async () => {
      const res = await publishPipeline(p.id)
      setNotice(res.published ? { id: p.id, tone: 'success', text: t('pipelines.published', { version: res.version }) } : { id: p.id, tone: 'held', text: t('pipelines.awaitingApprovalNotice', { version: res.version }) })
    })
  }

  const discard = async (p: PipelineRow) => {
    if (await confirm({ title: t('pipelines.discardTitle', { version: p.draftVersion ?? '' }), description: t('pipelines.discardBody'), confirmLabel: t('pipelines.discardDraft'), tone: 'danger' }))
      await attempt(p, () => discardDraft(p.id), t('pipelines.discarded'))
  }

  const remove = async () => {
    if (!deleting) return
    setBusyDelete(true)
    try {
      await deletePipeline(deleting.id)
      toast({ message: t('pipelines.deleted') })
      setDeleting(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
      setDeleting(null)
    } finally {
      setBusyDelete(false)
    }
  }

  const openPreview = async (name: string) => {
    try {
      const res = await getDatasetPreview(name)
      setPreview({ name, rows: res.rows })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('common.somethingWrong'))
    }
  }

  // Deep links (Go to, Help, notifications): ?new, ?import, ?maintenance, ?approvals, ?edit=<id>, ?history=<id>, #datasets.
  const reveal = (id: string) => window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: 'start' }), 80)
  useUrlIntents(!loading, {
    new: () => editable && setPicking(true),
    import: () => editable && setImporting(true),
    maintenance: () => setMaintenance(true),
    approvals: () => {
      setApprovalHistory(true)
      reveal('approvals')
    },
    edit: (id) => {
      const p = items.find((x) => x.id === id)
      // People who can't edit get the pipeline's run history instead.
      if (p) (canEdit ? setEditing(toEditable(p)) : setHistoryFor(p))
    },
    history: (id) => {
      const p = items.find((x) => x.id === id)
      if (p) setHistoryFor(p)
    },
  })
  useHashTarget(!loading)

  const newButton = editable && (
    <Button data-tour="pipelines-new" onClick={() => setPicking(true)} disabled={loading}>
      <Plus /> {t('pipelines.new')}
    </Button>
  )

  return (
    <div>
      {editing && (
        <PipelineEditor
          initial={editing}
          options={options}
          onClose={() => setEditing(null)}
          onSaved={async (id, res) => {
            setEditing(null)
            if (res.approvalId) setNotice({ id, tone: 'held', text: t('pipelines.awaitingApprovalNotice', { version: res.version }) })
            else if (res.published) setNotice({ id, tone: 'success', text: t('pipelines.published', { version: res.version }) })
            await load()
          }}
        />
      )}
      {picking && (
        <TemplatePicker
          options={options}
          onClose={() => setPicking(false)}
          onPick={(p) => {
            setPicking(false)
            setEditing(p)
          }}
        />
      )}
      {promoting && (
        <PromoteDialog
          pipelineId={promoting}
          onClose={() => setPromoting(null)}
          onDone={async (text) => {
            const id = promoting
            setPromoting(null)
            setNotice({ id, tone: 'success', text })
            await load()
          }}
        />
      )}
      {alertsFor && <PipelineAlertsDialog pipelineId={alertsFor.id} pipelineName={alertsFor.name} onClose={() => setAlertsFor(null)} />}
      {historyFor && (
        <RunHistory
          pipelineId={historyFor.id}
          pipelineName={historyFor.name}
          currentVersion={items.find((p) => p.id === historyFor.id)?.version ?? historyFor.version ?? 0}
          onClose={() => setHistoryFor(null)}
          onRestored={load}
        />
      )}
      {confirmEl}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={t('pipelines.deleteTitle', { name: deleting?.name ?? '' })}
        description={t('pipelines.deleteBody')}
        confirmLabel={t('pipelines.delete')}
        tone="danger"
        busy={busyDelete}
        onConfirm={remove}
      />

      {maintenance && <MaintenanceWindowsDialog onClose={() => setMaintenance(false)} onChanged={() => setMaintenanceKey((k) => k + 1)} />}
      {importing && (
        <ImportPipelineDialog
          onClose={() => setImporting(false)}
          onImported={() => {
            setImporting(false)
            toast({ message: t('pipelines.transfer.imported') })
            void load()
          }}
        />
      )}
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            {t('pages.pipelines.title')} <EnvironmentBadge environment={workspace.environment} />
          </span>
        }
        description={t('pages.pipelines.description')}
        meta={!loading && items.length > 0 ? summary : undefined}
        actions={
          <>
            <Button variant="outline" aria-pressed={approvalHistory} onClick={() => setApprovalHistory((v) => !v)}>
              <ClipboardCheck /> {t('approvals.history')}
            </Button>
            <Button variant="outline" onClick={() => setMaintenance(true)}>
              <CalendarOff /> {t('pipelines.maintenance.open')}
            </Button>
            {canEdit && !workspace.locked && (
              <Button variant="outline" onClick={() => setImporting(true)}>
                <FileUp /> {t('pipelines.transfer.import')}
              </Button>
            )}
            {newButton}
          </>
        }
      />

      <div className="space-y-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {workspace.locked && (
          <Notice tone="warning" live={false}>
            <span className="inline-flex items-start gap-1.5">
              <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {t('pipelines.locked')}
            </span>
          </Notice>
        )}

        <ActiveMaintenanceNotice refreshKey={maintenanceKey} />
        <div id="approvals" className="scroll-mt-6">
          <ApprovalsPanel refreshKey={approvalsKey} onDecided={() => void load()} history={approvalHistory} onHistoryChange={setApprovalHistory} />
        </div>

        <section data-tour="pipelines-board" aria-labelledby="pipelines-board" className="rounded-lg border border-border bg-card">
          <h2 id="pipelines-board" className="sr-only">
            {t('pages.pipelines.title')}
          </h2>
          {items.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border px-4 py-3">
              <label className="relative w-full max-w-sm">
                <span className="sr-only">{t('pipelines.searchLabel')}</span>
                <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('pipelines.searchPlaceholder')} className="pl-8" />
              </label>
              <ul aria-label={t('pipelines.legend')} className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground lg:ml-auto">
                {(
                  [
                    ['live', 'state.live'],
                    ['paused', 'state.paused'],
                    ['tripped', 'state.tripped'],
                    ['held', 'state.awaitingApproval'],
                  ] as const
                ).map(([s, key]) => (
                  <li key={s}>
                    <StateMark state={s} className="text-xs font-normal">
                      {t(key)}
                    </StateMark>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {loading ? (
            <p className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          ) : items.length === 0 ? (
            <EmptyState icon={<Workflow />} title={t('pipelines.emptyTitle')} action={newButton || undefined}>
              <p>{options.dataSources.length ? t('pipelines.emptyBody') : t('pipelines.needSourceFirst')}</p>
              {!editable && <p className="mt-2 text-xs">{t('pipelines.adminsCreate')}</p>}
            </EmptyState>
          ) : visible.length === 0 ? (
            <EmptyState compact title={t('pipelines.noMatch', { query })} />
          ) : (
            <Table label={t('pages.pipelines.title')} className="md:min-w-[760px]">
              <THead>
                <tr>
                  <Th className="min-w-44 sm:min-w-56">{t('pipelines.colPipeline')}</Th>
                  <Th className="hidden xl:table-cell">{t('pipelines.colLine')}</Th>
                  <Th>{t('pipelines.colState')}</Th>
                  <Th className="hidden sm:table-cell">{t('pipelines.colLastRun')}</Th>
                  <Th className="hidden text-right md:table-cell">{t('pipelines.colRows')}</Th>
                  <Th className="text-right">
                    <span className="sr-only">{t('common.edit')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {visible.map(({ p, def, from, table, to, line }) => {
                  const published = (p.version ?? 0) > 0
                  const schedule = scheduleSchema.safeParse(p.schedule ?? {}).data ?? DEFAULT_SCHEDULE
                  const driver = def ? lanePlan(def).driver : null
                  const src = def?.nodes.find((n) => n.type === 'source' && n.id === driver)
                  const incremental = src?.type === 'source' && src.mode === 'incremental' ? src : null
                  const meta = [
                    describeScheduleT(schedule, t) + (schedule.type === 'after' ? ` (${items.find((x) => x.id === schedule.afterPipelineId)?.name ?? '—'})` : ''),
                    schedule.type !== 'manual' && p.enabled && p.nextRunAt ? t('pipelines.next', { when: when(p.nextRunAt) }) : null,
                    p.webhookTrigger ? t('pipelines.webhook') : null,
                  ].filter(Boolean)
                  return [
                    <Tr key={p.id} selected={notice?.id === p.id}>
                      <Td>
                        <div className="font-semibold text-pretty">{p.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          <span className="font-mono">
                            {published ? `v${p.version}` : t('pipelines.neverPublished')}
                            {p.draftVersion ? ` · ${t('pipelines.draftVersion', { version: p.draftVersion })}` : ''}
                            {(deployed[p.id] ?? []).map((d) =>
                              isEnvironment(d.environment) ? ` · ${ENVIRONMENT_INFO[d.environment].short}: ${d.version === null ? t('pipelines.notPromoted') : d.version ? `v${d.version}` : t('pipelines.neverPublished')}` : '',
                            )}
                          </span>
                          {' · '}
                          {meta.join(' · ')}
                        </div>
                        {incremental && (
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {t('pipelines.incremental', { column: incremental.watermarkColumn ?? '' })} · {p.syncPosition ? t('pipelines.syncedTo', { position: p.syncPosition }) : t('pipelines.firstRunAll')}
                          </div>
                        )}
                        {/* w-0 + min-w-full: the line truncates its names instead of widening the column (phones). */}
                        <div className="mt-1.5 w-0 min-w-full xl:hidden">
                          <FlowLine className="sm:max-w-sm" from={from} to={to} state={line.state} srLabel={t('pipelines.flowLabel', { from: table ? `${from} · ${table}` : from, to })} />
                        </div>
                      </Td>
                      <Td className="hidden xl:table-cell">
                        <FlowLine className="max-w-md" from={from} to={to} state={line.state} srLabel={t('pipelines.flowLabel', { from: table ? `${from} · ${table}` : from, to })} />
                      </Td>
                      <Td>
                        {line.state === 'tripped' && p.heldRows > 0 && p.lastRunStatus !== 'failed' ? (
                          <Link href={`/dashboard/quality?pipeline=${encodeURIComponent(p.id)}`} className="rounded-sm hover:underline">
                            <StateMark state="tripped">{line.label}</StateMark>
                          </Link>
                        ) : (
                          <StateMark state={line.state}>{line.label}</StateMark>
                        )}
                      </Td>
                      <Td className="hidden font-mono text-xs whitespace-nowrap text-muted-foreground sm:table-cell">
                        {when(p.lastRunAt)}
                        {p.lastRun?.duration != null && <div>{duration(p.lastRun.duration)}</div>}
                      </Td>
                      <Td className="hidden text-right font-mono text-xs whitespace-nowrap md:table-cell">
                        {p.lastRun ? (
                          <>
                            {formatNumber(p.lastRun.written ?? 0)} / {formatNumber(p.lastRun.read ?? 0)}
                            {p.heldRows > 0 && <div className="text-danger-text">{t('pipelines.heldLink', { count: formatNumber(p.heldRows) })}</div>}
                          </>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </Td>
                      <Td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {p.draftVersion && editable && (
                            <Button size="sm" variant="outline" onClick={() => void publish(p)}>
                              <Rocket /> {t('pipelines.publishDraft')}
                            </Button>
                          )}
                          {canRun && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => void run(p)}
                              disabled={running !== null || !published}
                              title={published ? undefined : t('pipelines.publishFirst')}
                              aria-label={t('pipelines.runFor', { name: p.name })}
                            >
                              {running === p.id ? <Loader2 className="animate-spin" /> : <Play />}
                              <span className="hidden sm:inline">{running === p.id ? t('pipelines.running') : t('pipelines.run')}</span>
                            </Button>
                          )}
                          <Menu>
                            <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label={t('pipelines.more', { name: p.name })} />}>
                              <MoreHorizontal />
                            </MenuTrigger>
                            <MenuContent>
                              {canEdit && (
                                <MenuItem onClick={() => setEditing(toEditable(p))}>
                                  {editable ? <Edit aria-hidden /> : <Eye aria-hidden />} {editable ? t('pipelines.edit') : t('pipelines.view')}
                                </MenuItem>
                              )}
                              <MenuItem onClick={() => setHistoryFor(p)}>
                                <History aria-hidden /> {t('pipelines.history')}
                              </MenuItem>
                              <MenuItem onClick={() => setAlertsFor(p)}>
                                <BellRing aria-hidden /> {t('pipelines.alerts.open')}
                              </MenuItem>
                              <MenuItem onClick={() => void downloadPipelineExport(p.id).catch((err) => setError(err instanceof Error ? err.message : t('pipelines.transfer.exportFailed')))}>
                                <FileDown aria-hidden /> {t('pipelines.transfer.export')}
                              </MenuItem>
                              {canRun && published && schedule.type !== 'manual' && (
                                <MenuItem onClick={() => void toggle(p)}>
                                  {p.enabled ? <Pause aria-hidden /> : <Play aria-hidden />} {p.enabled ? t('pipelines.pauseSchedule') : t('pipelines.resumeSchedule')}
                                </MenuItem>
                              )}
                              {canEdit && published && workspace.environment && workspace.environment !== 'prod' && (
                                <MenuItem onClick={() => setPromoting(p.id)}>
                                  <ArrowUpRight aria-hidden /> {t('pipelines.promote')}
                                </MenuItem>
                              )}
                              {p.draftVersion && editable && published && (
                                <MenuItem onClick={() => void discard(p)}>
                                  <Undo2 aria-hidden /> {t('pipelines.discardDraft')}
                                </MenuItem>
                              )}
                              {incremental && p.syncPosition && canEdit && (
                                <MenuItem onClick={() => void resetSync(p)}>
                                  <RotateCcw aria-hidden /> {t('pipelines.resetSync')}
                                </MenuItem>
                              )}
                              {editable && (
                                <>
                                  <MenuSeparator />
                                  <MenuItem onClick={() => setDeleting(p)} className="text-danger-text [&_svg]:text-danger-text!">
                                    <Trash2 aria-hidden /> {t('pipelines.delete')}
                                  </MenuItem>
                                </>
                              )}
                            </MenuContent>
                          </Menu>
                        </div>
                      </Td>
                    </Tr>,
                    notice?.id === p.id ? (
                      <tr key={`${p.id}-notice`}>
                        <td colSpan={6} className="px-4 pb-3">
                          <Notice tone={notice.tone}>{notice.text}</Notice>
                        </td>
                      </tr>
                    ) : null,
                  ]
                })}
              </TBody>
            </Table>
          )}
        </section>

        {options.datasets.length > 0 && (
          <section id="datasets" aria-labelledby="datasets-title" className="scroll-mt-6 rounded-lg border border-border bg-card">
            <div className="border-b border-border px-4 py-3">
              <h2 id="datasets-title" className="text-base font-semibold">
                {t('pipelines.datasetsTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">{t('pipelines.datasetsBody')}</p>
            </div>
            <Table label={t('pipelines.datasetsTitle')}>
              <THead>
                <tr>
                  <Th>{t('pipelines.colDataset')}</Th>
                  <Th className="text-right">{t('pipelines.colRows')}</Th>
                  <Th className="hidden text-right sm:table-cell">{t('pipelines.colColumns')}</Th>
                  <Th className="hidden md:table-cell">{t('pipelines.colLoaded')}</Th>
                  <Th className="text-right">
                    <span className="sr-only">{t('sources.preview')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {options.datasets.map((d) => (
                  <Tr key={d.name}>
                    <Td className="font-mono text-sm font-medium">{d.name}</Td>
                    <Td className="text-right font-mono text-xs">{formatNumber(d.rowCount ?? 0)}</Td>
                    <Td className="hidden text-right font-mono text-xs sm:table-cell">{d.columns.length}</Td>
                    <Td className="hidden font-mono text-xs text-muted-foreground md:table-cell">{when(d.lastLoadedAt)}</Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" disabled={!canPreview} title={canPreview ? undefined : t('pipelines.noPreview')} aria-label={t('pipelines.previewDataset', { name: d.name })} onClick={() => void openPreview(d.name)}>
                        <Eye /> {t('sources.preview')}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </section>
        )}
      </div>

      {preview && (
        <Modal onClose={() => setPreview(null)} title={t('pipelines.latestRows', { name: preview.name })} size="xl">
          {preview.rows.length ? <SampleTable rows={preview.rows} /> : <p className="text-sm text-muted-foreground">{t('pipelines.datasetEmpty')}</p>}
        </Modal>
      )}
    </div>
  )
}
