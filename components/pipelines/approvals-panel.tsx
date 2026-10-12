'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCheck, ClipboardCheck, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { approveRequest, cancelRequest, listApprovals, rejectRequest } from '@/lib/actions/approvals'
import { describeDiff } from '@/lib/audit-diff'
import { formatWhen } from '@/components/pipelines/run-history'

type Request = Awaited<ReturnType<typeof listApprovals>>[number]

const STATUS_STYLE: Record<string, string> = {
  pending: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  approved: 'border-green-500/40 bg-green-500/10 text-green-700 dark:text-green-400',
  rejected: 'border-destructive/40 bg-destructive/10 text-destructive',
}

/**
 * Pipeline versions waiting for a second person (GV-6). Approvers decide;
 * requesters see and can cancel their own. Hidden when there is nothing pending
 * and the history is closed.
 */
export default function ApprovalsPanel({ refreshKey, onDecided }: { refreshKey: number; onDecided: () => void }) {
  const [items, setItems] = useState<Request[]>([])
  const [history, setHistory] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

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

  const pending = items.filter((r) => r.status === 'pending')
  if (loading || (!history && !pending.length && !message)) {
    return loading ? null : (
      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => setHistory(true)}>
          <ClipboardCheck className="mr-1 h-4 w-4" /> Approval history
        </Button>
      </div>
    )
  }

  return (
    <section className="rounded-xl border border-amber-500/40 bg-card" aria-label="Approvals">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <ClipboardCheck className="h-4 w-4 text-primary" />
        <h3 className="mr-auto font-semibold">Approvals{pending.length ? ` (${pending.length} waiting)` : ''}</h3>
        <Button size="sm" variant="ghost" onClick={() => setHistory((v) => !v)}>
          {history ? 'Only waiting' : 'History'}
        </Button>
      </div>
      {message && <p className={`border-b border-border p-3 text-sm ${message.kind === 'ok' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>{message.text}</p>}
      {!items.length ? (
        <p className="p-4 text-sm text-muted-foreground">No approval requests yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((r) => {
            const lines = describeDiff(r.changes)
            return (
              <li key={r.id} className="space-y-2 p-4 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    {r.pipelineName} v{r.version}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? 'border-border text-muted-foreground'}`}>{r.status}</span>
                  {r.kind === 'promote' && <Badge variant="outline">promotion{r.fromWorkspace ? ` from ${r.fromWorkspace}` : ''}</Badge>}
                  <span className="text-xs text-muted-foreground">
                    requested by {r.mine ? 'you' : r.requestedBy} · {formatWhen(r.createdAt)} · runs v{r.publishedVersion || '–'} today
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
                    <summary className="cursor-pointer text-primary">
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
                    {r.status} by {r.decidedBy} {formatWhen(r.decidedAt)}
                    {r.decisionNote ? `: ${r.decisionNote}` : ''}
                  </p>
                )}
                {r.canDecide && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input className="h-8 max-w-xs" placeholder="Note (required to reject)" value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} aria-label={`Note for ${r.pipelineName} v${r.version}`} />
                    <Button size="sm" disabled={busy !== null} onClick={() => void act(r.id, async () => `Approved: ${r.pipelineName} v${(await approveRequest({ id: r.id, note: notes[r.id] ?? '' })).version} is published.`)}>
                      {busy === r.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1 h-4 w-4" />} Approve & publish
                    </Button>
                    <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act(r.id, async () => (await rejectRequest({ id: r.id, note: notes[r.id] ?? '' }), `Rejected ${r.pipelineName} v${r.version}.`))}>
                      <X className="mr-1 h-4 w-4" /> Reject
                    </Button>
                  </div>
                )}
                {r.status === 'pending' && r.mine && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    Waiting for an admin or data steward.
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(r.id, async () => (await cancelRequest(r.id), 'Request cancelled.'))}>
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
