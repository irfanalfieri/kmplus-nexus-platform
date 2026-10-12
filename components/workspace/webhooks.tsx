'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Check, Copy, Loader2, Plus, Send, Webhook } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { SettingsPanel } from '@/components/workspace/settings-panel'
import { createWebhook, deleteWebhook, listWebhooks, testWebhook, updateWebhook } from '@/lib/actions/webhooks'
import { formatWhen } from '@/components/pipelines/run-history'

type Hook = Awaited<ReturnType<typeof listWebhooks>>[number]
const EVENTS = [
  ['run.succeeded', 'Run succeeded (incl. partial)'],
  ['run.failed', 'Run failed'],
  ['dataset.updated', 'Dataset updated'],
] as const

const tagClass = 'rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground'

/** Outbound webhooks (API-5): signed POSTs to other systems when runs finish and datasets change. */
export function Webhooks() {
  const id = useId()
  const [hooks, setHooks] = useState<Hook[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState<string[]>(['run.failed'])
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, confirmEl] = useConfirm()

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

  const run = async (key: string, fn: () => Promise<string | void>) => {
    setBusy(key)
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
    <SettingsPanel
      title="Webhooks"
      description={
        <>
          Nexus POSTs a signed JSON event to your HTTPS endpoint when a run finishes or a dataset changes. Verify the <span className="font-mono text-xs">Nexus-Signature</span> header with the secret (HMAC-SHA256 of{' '}
          <span className="font-mono text-xs">timestamp.body</span>). Failed deliveries are retried for about 2.5 hours.
        </>
      }
    >
      <div className="space-y-3">
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Add endpoint
          </Button>
        )}

        {secret && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm" role="status">
            <h3 className="font-semibold">Signing secret: copy it now. It won&apos;t be shown again.</h3>
            <div className="flex gap-2">
              <Input readOnly value={secret} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Webhook signing secret" />
              <Button
                size="icon"
                variant="outline"
                aria-label={copied ? 'Signing secret copied' : 'Copy signing secret'}
                onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <Button variant="ghost" onClick={() => setSecret(null)}>
                Done
              </Button>
            </div>
          </div>
        )}

        {adding && (
          <form
            className="space-y-3 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault()
              if (!url || !events.length) return
              void run('new', async () => {
                const res = await createWebhook({ url, events: events as ('run.succeeded' | 'run.failed' | 'dataset.updated')[] })
                setSecret(res.secret)
                setCopied(false)
                setAdding(false)
                setUrl('')
              })
            }}
          >
            <h3 className="text-sm font-semibold">New endpoint</h3>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-url`}>Endpoint URL (https)</Label>
              <Input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://kms.kmplus.co.id/hooks/nexus" className="font-mono" />
            </div>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1.5 text-sm font-medium">Events</legend>
              {EVENTS.map(([e, label]) => (
                <label key={e} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={events.includes(e)}
                    onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((y) => y !== e))}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy === 'new' || !url || !events.length}>
                {busy === 'new' && <Loader2 className="animate-spin" aria-hidden />} Add endpoint
              </Button>
            </div>
          </form>
        )}

        {notice && <Notice tone="info">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {!hooks ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : hooks.length === 0 ? (
          !adding && (
            <EmptyState compact icon={<Webhook />} title="No webhooks yet">
              Add an endpoint to tell another system when runs finish or datasets change.
            </EmptyState>
          )
        ) : (
          <ul className="space-y-2">
            {hooks.map((h) => (
              <li key={h.id} className={cn('rounded-md border border-border p-3 text-sm', !h.enabled && 'bg-muted/40')}>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="min-w-0 flex-1 truncate font-mono text-xs font-medium" title={h.url}>
                    {h.url}
                  </h3>
                  {h.events.map((e) => (
                    <span key={e} className={tagClass}>
                      {e}
                    </span>
                  ))}
                  <StateMark state={h.enabled ? 'live' : 'paused'} className="text-xs">
                    {h.enabled ? 'Active' : 'Paused'}
                  </StateMark>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === h.id}
                    onClick={() =>
                      void run(h.id, async () => {
                        const r = await testWebhook(h.id)
                        return r.delivered ? `Test delivered (HTTP ${r.responseStatus}).` : `Test failed: ${r.error ?? 'no response'}. It will be retried.`
                      })
                    }
                  >
                    <Send aria-hidden /> Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === h.id}
                    onClick={() => void run(h.id, async () => (await updateWebhook({ id: h.id, enabled: !h.enabled }), h.enabled ? 'Paused.' : 'Resumed.'))}
                  >
                    {h.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === h.id}
                    aria-label={`Delete webhook ${h.url}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this webhook?',
                        description: `Nexus stops sending events to ${h.url}. Its delivery history is removed. This cannot be undone.`,
                        confirmLabel: 'Delete webhook',
                        tone: 'danger',
                      })
                      if (ok) void run(h.id, async () => (await deleteWebhook(h.id), 'Webhook deleted.'))
                    }}
                  >
                    Delete
                  </Button>
                </div>
                {h.deliveries.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground" aria-label="Recent deliveries">
                    {h.deliveries.slice(0, 5).map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-x-1.5">
                        <span className="font-mono">{formatWhen(d.createdAt)}</span> · <span className="font-mono">{d.event}</span> ·
                        <StateMark state={d.status === 'delivered' ? 'live' : d.status === 'failed' ? 'tripped' : 'paused'} className="text-xs">
                          {d.status}
                          {d.responseStatus ? ` (HTTP ${d.responseStatus})` : ''}
                        </StateMark>
                        {d.status !== 'delivered' && d.error ? <span>· {d.error}</span> : null}
                        {d.attempts > 1 ? <span>· {d.attempts} attempts</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}
