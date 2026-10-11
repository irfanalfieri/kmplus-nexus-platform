'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, Plus, Send, Webhook } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { createWebhook, deleteWebhook, listWebhooks, testWebhook, updateWebhook } from '@/lib/actions/webhooks'
import { formatWhen } from '@/components/pipelines/run-history'

type Hook = Awaited<ReturnType<typeof listWebhooks>>[number]
const EVENTS = [
  ['run.succeeded', 'Run succeeded (incl. partial)'],
  ['run.failed', 'Run failed'],
  ['dataset.updated', 'Dataset updated'],
] as const

/** Outbound webhooks (API-5): signed POSTs to other systems when runs finish and datasets change. */
export function Webhooks() {
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['run.failed'])
  const [secret, setSecret] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setHooks(await listWebhooks())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id)
    setError('')
    setNotice('')
    try {
      const msg = await fn()
      if (msg) setNotice(msg)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Webhooks">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <Webhook className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <h3 className="font-semibold">Webhooks</h3>
          <p className="text-sm text-muted-foreground">
            Nexus POSTs a signed JSON event to your HTTPS endpoint when a run finishes or a dataset changes. Verify the <span className="font-mono text-xs">Nexus-Signature</span> header with the secret (HMAC-SHA256 of <span className="font-mono text-xs">timestamp.body</span>). Failed deliveries are retried for about 2.5 hours.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add endpoint
          </Button>
        )}
      </div>

      {secret && (
        <div className="mb-3 space-y-1 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status">
          <div className="font-medium">Signing secret: copy it now. It won&apos;t be shown again.</div>
          <div className="flex gap-2">
            <Input readOnly value={secret} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Webhook signing secret" />
            <Button size="sm" variant="ghost" onClick={() => setSecret(null)}>Done</Button>
          </div>
        </div>
      )}

      {adding && (
        <div className="mb-3 space-y-2 rounded-md border border-border p-3">
          <label className="block text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Endpoint URL (https)</span>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://kms.kmplus.co.id/hooks/nexus" className="font-mono" />
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            {EVENTS.map(([e, label]) => (
              <label key={e} className="flex items-center gap-1.5">
                <input type="checkbox" checked={events.includes(e)} onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((y) => y !== e))} />
                {label}
              </label>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy === 'new' || !url || !events.length}
              onClick={() =>
                void run('new', async () => {
                  const res = await createWebhook({ url, events: events as ('run.succeeded' | 'run.failed' | 'dataset.updated')[] })
                  setSecret(res.secret)
                  setAdding(false)
                  setUrl('')
                })
              }
            >
              {busy === 'new' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Add endpoint
            </Button>
          </div>
        </div>
      )}

      {notice && <p className="mb-3 rounded-md bg-muted/50 p-2 text-sm" role="status">{notice}</p>}
      {error && <p className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">{error}</p>}

      {!hooks ? (
        <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</p>
      ) : hooks.length === 0 ? (
        !adding && <p className="text-sm text-muted-foreground">No webhooks yet.</p>
      ) : (
        <ul className="space-y-2">
          {hooks.map((h) => (
            <li key={h.id} className={`rounded-md border border-border p-3 text-sm ${h.enabled ? '' : 'opacity-70'}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono text-xs" title={h.url}>{h.url}</span>
                {h.events.map((e) => (
                  <Badge key={e} variant="secondary" className="text-[10px]">{e}</Badge>
                ))}
                {!h.enabled && <Badge variant="outline">paused</Badge>}
                <Button size="sm" variant="outline" disabled={busy === h.id} onClick={() => void run(h.id, async () => {
                  const r = await testWebhook(h.id)
                  return r.delivered ? `Test delivered (HTTP ${r.responseStatus}).` : `Test failed: ${r.error ?? 'no response'}. It will be retried.`
                })}>
                  <Send className="mr-1 h-3.5 w-3.5" /> Send test
                </Button>
                <Button size="sm" variant="ghost" disabled={busy === h.id} onClick={() => void run(h.id, async () => (await updateWebhook({ id: h.id, enabled: !h.enabled }), h.enabled ? 'Paused.' : 'Resumed.'))}>
                  {h.enabled ? 'Pause' : 'Resume'}
                </Button>
                {confirm === h.id ? (
                  <span className="flex items-center gap-1 text-xs">
                    Delete?
                    <Button size="sm" variant="destructive" onClick={() => void run(h.id, async () => (await deleteWebhook(h.id), 'Webhook deleted.'))}>Delete</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirm(h.id)}>Delete</Button>
                )}
              </div>
              {h.deliveries.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">
                  {h.deliveries.slice(0, 5).map((d) => (
                    <li key={d.id}>
                      {formatWhen(d.createdAt)} · {d.event} ·{' '}
                      <span className={d.status === 'delivered' ? 'text-green-700 dark:text-green-400' : d.status === 'failed' ? 'text-destructive' : ''}>
                        {d.status}
                        {d.responseStatus ? ` (HTTP ${d.responseStatus})` : ''}
                      </span>
                      {d.status !== 'delivered' && d.error ? ` · ${d.error}` : ''}
                      {d.attempts > 1 ? ` · ${d.attempts} attempts` : ''}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
