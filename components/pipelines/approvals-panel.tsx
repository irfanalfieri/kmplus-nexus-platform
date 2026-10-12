'use client'

import { useCallback, useEffect, useState } from 'react'
import { useT } from '@/components/i18n/i18n-provider'
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
import { formatWhen } from '@/components/pipelines/run-history'

type Request = Awaited<ReturnType<typeof listApprovals>>[number]

const STATUS_STATE: Record<string, FlowState> = {
  pending: 'held',
  approved: 'live',
  rejected: 'tripped',
}

/**
 * Pipeline versions waiting for a second person (GV-6). Approvers decide;
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
  const t = useT()
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
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not load approvals' })
    } finally {
      setLoading(false)
    }
  }, [history])

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
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(null)
    }
  }

  const approve = async (r: Request) => {
    const ok = await confirm({
      title: `Approve and publish ${r.pipelineName} v${r.version}?`,
      description: `It replaces v${r.publishedVersion || '–'} as the running version right away.`,
      confirmLabel: 'Approve & publish',
    })
    if (ok) await act(r.id, async () => `Approved: ${r.pipelineName} v${(await approveRequest({ id: r.id, note: notes[r.id] ?? '' })).version} is published.`)
  }
  const reject = async (r: Request) => {
    const ok = await confirm({
      title: `Reject ${r.pipelineName} v${r.version}?`,
      description: 'The requester sees your note. The running version stays as it is.',
      confirmLabel: 'Reject',
      tone: 'danger',
    })
    if (ok) await act(r.id, async () => (await rejectRequest({ id: r.id, note: notes[r.id] ?? '' }), `Rejected ${r.pipelineName} v${r.version}.`))
  }
  const cancel = async (r: Request) => {
    const ok = await confirm({
      title: 'Cancel this approval request?',
      description: `${r.pipelineName} v${r.version} stays a draft and is not published.`,
      confirmLabel: 'Cancel request',
      cancelLabel: 'Keep request',
      tone: 'danger',
    })
    if (ok) await act(r.id, async () => (await cancelRequest(r.id), 'Request cancelled.'))
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
                    {r.pipelineName} <span className="font-mono">v{r.version}</span>
                  </span>
                  <StateMark state={STATUS_STATE[r.status] ?? 'idle'} className="text-xs">
                    {r.status}
                  </StateMark>
                  {r.kind === 'promote' && (
                    <Badge variant="outline" className="rounded-sm">
                      promotion{r.fromWorkspace ? ` from ${r.fromWorkspace}` : ''}
                    </Badge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    requested by {r.mine ? 'you' : r.requestedBy} · <span className="font-mono">{formatWhen(r.createdAt)}</span> · runs <span className="font-mono">v{r.publishedVersion || '–'}</span> today
                  </span>
                </div>
                {r.reasons.length > 0 && (
                  <ul className="list-inside list-disc text-xs text-muted-foreground">
                    {r.reasons.map((x) => (
                      <li key={x}>{x}</li>
                    ))}
                  </ul>
                )}
                {r.requestNote && <p className="text-xs">Note: {r.requestNote}</p>}
                {lines.length > 0 && (
                  <details className="text-xs">
                    <summary className="cursor-pointer rounded-sm text-info-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                      {lines.length} change{lines.length === 1 ? '' : 's'} from the running version
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
                    {r.status} by {r.decidedBy} <span className="font-mono">{formatWhen(r.decidedAt)}</span>
                    {r.decisionNote ? `: ${r.decisionNote}` : ''}
                  </p>
                )}
                {r.canDecide && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="max-w-xs" placeholder="Note (required to reject)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label={`Note for ${r.pipelineName} v${r.version}`} />
                    <Button size="sm" disabled={busy !== null} onClick={() => void approve(r)}>
                      {busy === r.id ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />} Approve &amp; publish
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void reject(r)}>
                      <X aria-hidden /> Reject
                    </Button>
                  </div>
                )}
                {r.status === 'pending' && r.mine && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    Waiting for an admin or data steward.
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancel(r)}>
                      Cancel request
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
