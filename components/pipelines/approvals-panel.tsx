'use client'

import { useCallback, useEffect, useState } from 'react'
import { usePrefs } from '@/components/i18n/i18n-provider'
import type { MessageKey } from '@/lib/i18n/translate'
import { CheckCheck, ClipboardCheck, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { StateMark, type FlowState } from '@/components/ui/flow-line'
import { approveRequest, cancelRequest, listApprovals, rejectRequest } from '@/lib/actions/approvals'
import { describeDiff } from '@/lib/audit-diff'

type Request = Awaited<ReturnType<typeof listApprovals>>[number]

const STATUS_STATE: Record<string, FlowState> = {
  pending: 'held',
  approved: 'live',
  rejected: 'tripped',
}
const STATUS_TEXT: Record<string, MessageKey> = {
  pending: 'editor.approvals.status.pending',
  approved: 'editor.approvals.status.approved',
  rejected: 'editor.approvals.status.rejected',
  cancelled: 'editor.approvals.status.cancelled',
  superseded: 'editor.approvals.status.superseded',
}

/**
 * Pipeline versions and schema changes waiting for a second person (GV-6). Approvers decide;
 * requesters see and can cancel their own. Hidden when there is nothing pending
 * and the history is closed.
 */
/** `history` + `onHistoryChange` let the page put the "Approval history" switch in its own header. */
export default function ApprovalsPanel({
  refreshKey,
  onDecided,
  history: controlledHistory,
  onHistoryChange,
}: {
  refreshKey: number
  onDecided: () => void
  history?: boolean
  onHistoryChange?: (open: boolean) => void
}) {
  const { t, formatDateTime } = usePrefs()
  const when = (v: Date | string | null | undefined) =>
    v ? `${formatDateTime(v, { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' })} WIB` : '—'
  const statusText = (s: string) => (STATUS_TEXT[s] ? t(STATUS_TEXT[s]) : s)
  const [items, setItems] = useState<Request[]>([])
  const [ownHistory, setOwnHistory] = useState(false)
  const history = controlledHistory ?? ownHistory
  const setHistory = (next: boolean | ((open: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(history) : next
    if (onHistoryChange) onHistoryChange(value)
    else setOwnHistory(value)
  }
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    try {
      setItems(await listApprovals(history ? 'all' : 'pending'))
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('editor.approvals.loadFailed') })
    } finally {
      setLoading(false)
    }
  }, [history, t])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const act = async (id: string, action: () => Promise<string>) => {
    setBusy(id)
    setMessage(null)
    try {
      setMessage({ kind: 'ok', text: await action() })
      await load()
      onDecided()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('editor.approvals.failed') })
    } finally {
      setBusy(null)
    }
  }

  /** Reasons not already shown as a schema change line. */
  const reasonsOf = (r: Request) => (r.schema ? r.reasons.filter((x) => !x.startsWith(`${r.schema!.datasetName}: `)) : r.reasons)
  /** What a request is about: a pipeline, or the schema of a dataset. */
  const label = (r: Request) => (r.schema ? t('approvals.schemaName', { dataset: r.schema.datasetName }) : r.pipelineName)
  const approve = async (r: Request) => {
    if (r.schema) {
      const ok = await confirm({
        title: t('approvals.schemaApproveTitle', { dataset: r.schema.datasetName }),
        description: t('approvals.schemaApproveBody'),
        confirmLabel: t('approvals.applyChange'),
        tone: 'danger',
      })
      if (ok) await act(r.id, async () => t('approvals.schemaApproved', { dataset: r.schema!.datasetName, version: (await approveRequest({ id: r.id, note: notes[r.id] ?? '' })).version }))
      return
    }
    const ok = await confirm({
      title: t('editor.approvals.approveTitle', { name: r.pipelineName, version: r.version }),
      description: t('editor.approvals.approveBody', { version: r.publishedVersion || '–' }),
      confirmLabel: t('editor.approvals.approvePublish'),
    })
    if (ok) await act(r.id, async () => t('editor.approvals.approved', { name: r.pipelineName, version: (await approveRequest({ id: r.id, note: notes[r.id] ?? '' })).version }))
  }
  const reject = async (r: Request) => {
    const ok = await confirm({
      title: t('editor.approvals.rejectTitle', { name: label(r), version: r.version }),
      description: t('editor.approvals.rejectBody'),
      confirmLabel: t('editor.approvals.reject'),
      tone: 'danger',
    })
    if (ok) await act(r.id, async () => (await rejectRequest({ id: r.id, note: notes[r.id] ?? '' }), t('editor.approvals.rejected', { name: label(r), version: r.version })))
  }
  const cancel = async (r: Request) => {
    const ok = await confirm({
      title: r.schema ? t('schemas.panel.cancelTitle') : t('editor.approvals.cancelTitle'),
      description: r.schema ? t('approvals.schemaCancelBody', { dataset: r.schema.datasetName }) : t('editor.approvals.cancelBody', { name: label(r), version: r.version }),
      confirmLabel: t('editor.approvals.cancelRequest'),
      cancelLabel: t('editor.approvals.keepRequest'),
      tone: 'danger',
    })
    if (ok) await act(r.id, async () => (await cancelRequest(r.id), t('editor.approvals.cancelled')))
  }

  const pending = items.filter((r) => r.status === 'pending')
  if (loading || (!history && !pending.length && !message)) {
    return loading || onHistoryChange ? null : (
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
          <ClipboardCheck aria-hidden /> {t('approvals.history')}
        </Button>
      </div>
    )
  }

  return (
    <section className="rounded-lg border border-border bg-card" aria-labelledby="approvals-heading">
      {confirmDialog}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <ClipboardCheck className="size-4 text-held" aria-hidden />
        <h2 id="approvals-heading" className="mr-auto font-semibold">
          {t('approvals.title')}
          {pending.length ? (
            <span className="ml-2 font-mono text-sm font-medium text-held-text">{t('approvals.waiting', { count: pending.length })}</span>
          ) : null}
        </h2>
        <Button size="sm" variant="ghost" onClick={() => setHistory((v) => !v)} aria-pressed={history}>
          {history ? t('approvals.onlyWaiting') : t('approvals.historyShort')}
        </Button>
      </div>
      {message && (
        <Notice tone={message.kind === 'ok' ? 'success' : 'danger'} className="m-4 mb-0">
          {message.text}
        </Notice>
      )}
      {!items.length ? (
        <EmptyState compact icon={<ClipboardCheck />} title={t('approvals.emptyTitle')}>
          {t('approvals.emptyBody')}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((r) => {
            const lines = describeDiff(r.changes)
            return (
              <li key={r.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-medium">
                    {label(r)} <span className="font-mono">v{r.version}</span>
                  </span>
                  <StateMark state={STATUS_STATE[r.status] ?? 'idle'} className="text-xs">
                    {statusText(r.status)}
                  </StateMark>
                  {r.schema && (
                    <Badge variant="outline" className="rounded-sm">
                      {t('approvals.schemaChange')}
                    </Badge>
                  )}
                  {r.kind === 'promote' && (
                    <Badge variant="outline" className="rounded-sm">
                      {r.fromWorkspace ? t('editor.approvals.promotionFrom', { workspace: r.fromWorkspace }) : t('editor.approvals.promotion')}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t('editor.approvals.requestedBy', { who: r.mine ? t('editor.approvals.you') : r.requestedBy })} · <span className="font-mono">{when(r.createdAt)}</span> ·{' '}
                    {r.schema ? t('approvals.schemaToday', { version: `v${r.schema.currentVersion || r.schema.baseVersion}` }) : t('editor.approvals.runsToday', { version: `v${r.publishedVersion || '–'}` })}
                  </span>
                </div>
                {reasonsOf(r).length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {reasonsOf(r).map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
                {r.schema && <SchemaImpact schema={r.schema} />}
                {r.requestNote && <p className="text-xs">{t('editor.approvals.note', { note: r.requestNote })}</p>}
                {lines.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer rounded-sm text-info-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {t('editor.approvals.changes', { count: lines.length })}
                    </summary>
                    <ul className="mt-1 space-y-0.5 font-mono text-muted-foreground">
                      {lines.map((l, i) => (
                        <li key={i} className="break-all">
                          {l}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                {r.status !== 'pending' && r.decidedBy && (
                  <p className="text-xs text-muted-foreground">
                    {t('editor.approvals.decidedBy', { status: statusText(r.status), who: r.decidedBy })} <span className="font-mono">{when(r.decidedAt)}</span>
                    {r.decisionNote ? `: ${r.decisionNote}` : ''}
                  </p>
                )}
                {r.canDecide && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="max-w-xs" placeholder={t('editor.approvals.notePlaceholder')} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label={t('editor.approvals.noteFor', { name: label(r), version: r.version })} />
                    <Button size="sm" disabled={busy !== null} onClick={() => void approve(r)}>
                      {busy === r.id ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />} {r.schema ? t('approvals.applyChange') : t('editor.approvals.approvePublish')}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void reject(r)}>
                      <X aria-hidden /> {t('editor.approvals.reject')}
                    </Button>
                  </div>
                )}
                {r.status === 'pending' && r.mine && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    {t('editor.approvals.waitingFor')}
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancel(r)}>
                      {t('editor.approvals.cancelRequest')}
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/** A schema request: its changes, the rows they touch and who reads the dataset. */
function SchemaImpact({ schema }: { schema: NonNullable<Request['schema']> }) {
  const { t } = usePrefs()
  const usage = schema.usage
  const lines: string[] = []
  for (const r of schema.rows) {
    if (r.emptyRows) lines.push(t('schemas.panel.emptyRows', { count: r.emptyRows, column: r.column }))
    if (r.failingRows) lines.push(t('approvals.schemaFailing', { count: r.failingRows, column: r.column }))
  }
  if (usage) {
    if (usage.pipelines.length) lines.push(t('schemas.panel.impactPipelines', { names: usage.pipelines.join(', ') }))
    if (usage.dashboards.length) lines.push(t('schemas.panel.impactDashboards', { names: usage.dashboards.join(', ') }))
    if (usage.apiKeys.length) lines.push(t('schemas.panel.impactApiKeys', { names: usage.apiKeys.join(', ') }))
    if (!usage.pipelines.length && !usage.dashboards.length && !usage.apiKeys.length) lines.push(t('schemas.panel.noImpact'))
  }
  return (
    <div className="space-y-1 text-xs">
      <ul className="list-inside list-disc font-mono">
        {schema.lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      {lines.map((l) => (
        <p key={l} className="text-muted-foreground">{l}</p>
      ))}
    </div>
  )
}
