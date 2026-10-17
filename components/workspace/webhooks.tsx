'use client'

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
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
import { usePrefs } from '@/components/i18n/i18n-provider'

type Hook = Awaited<ReturnType<typeof listWebhooks>>[number]
const EVENTS = [
  ['run.succeeded', 'runSucceeded'],
  ['run.failed', 'runFailed'],
  ['dataset.updated', 'datasetUpdated'],
  ['dataset.schema_changed', 'schemaChanged'],
] as const

const DELIVERY_STATUSES = ['pending', 'delivered', 'failed'] as const
type DeliveryStatus = (typeof DELIVERY_STATUSES)[number]
const isDeliveryStatus = (s: string): s is DeliveryStatus => (DELIVERY_STATUSES as readonly string[]).includes(s)

/** Short date and time in WIB, in the interface language. */
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

const tagClass = 'rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground'

/** Outbound webhooks (API-5): signed POSTs to other systems when runs finish and datasets change. */
export function Webhooks() {
  const { t, formatDateTime } = usePrefs()
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
      setError(err instanceof Error ? err.message : t('ws.webhooks.loadFailed'))
    }
  }, [t])

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
      setError(err instanceof Error ? err.message : t('ws.common.failed'))
    } finally {
      setBusy(null)
    }
  }

  return (
    <SettingsPanel
      title={t('ws.webhooks.title')}
      description={rich(t('ws.webhooks.description'), {
        header: <span className="font-mono text-xs">Nexus-Signature</span>,
        payload: <span className="font-mono text-xs">timestamp.body</span>,
      })}
    >
      <div className="space-y-3">
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> {t('ws.webhooks.add')}
          </Button>
        )}

        {secret && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm" role="status">
            <h3 className="font-semibold">{t('ws.webhooks.secretOnce')}</h3>
            <div className="flex gap-2">
              <Input readOnly value={secret} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('ws.webhooks.secretLabel')} />
              <Button
                size="icon"
                variant="outline"
                aria-label={copied ? t('ws.webhooks.secretCopied') : t('ws.webhooks.copySecret')}
                onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <Button variant="ghost" onClick={() => setSecret(null)}>
                {t('ws.common.done')}
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
                const res = await createWebhook({ url, events: events as ('run.succeeded' | 'run.failed' | 'dataset.updated' | 'dataset.schema_changed')[] })
                setSecret(res.secret)
                setCopied(false)
                setAdding(false)
                setUrl('')
              })
            }}
          >
            <h3 className="text-sm font-semibold">{t('ws.webhooks.newEndpoint')}</h3>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-url`}>{t('ws.webhooks.url')}</Label>
              <Input id={`${id}-url`} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://kms.kmplus.co.id/hooks/nexus" className="font-mono" />
            </div>
            <fieldset className="flex flex-wrap gap-3 text-sm">
              <legend className="mb-1.5 text-sm font-medium">{t('ws.webhooks.events')}</legend>
              {EVENTS.map(([e, label]) => (
                <label key={e} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={events.includes(e)}
                    onChange={(x) => setEvents(x.target.checked ? [...events, e] : events.filter((y) => y !== e))}
                  />
                  {t(`ws.webhooks.eventLabels.${label}`)}
                </label>
              ))}
            </fieldset>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy === 'new' || !url || !events.length}>
                {busy === 'new' && <Loader2 className="animate-spin" aria-hidden />} {t('ws.webhooks.add')}
              </Button>
            </div>
          </form>
        )}

        {notice && <Notice tone="info">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {!hooks ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : hooks.length === 0 ? (
          !adding && (
            <EmptyState compact icon={<Webhook />} title={t('ws.webhooks.emptyTitle')}>
              {t('ws.webhooks.emptyBody')}
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
                    {h.enabled ? t('ws.common.active') : t('ws.common.paused')}
                  </StateMark>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === h.id}
                    onClick={() =>
                      void run(h.id, async () => {
                        const r = await testWebhook(h.id)
                        return r.delivered ? t('ws.webhooks.testDelivered', { status: String(r.responseStatus) }) : t('ws.webhooks.testFailed', { error: r.error ?? t('ws.webhooks.noResponse') })
                      })
                    }
                  >
                    <Send aria-hidden /> {t('ws.webhooks.sendTest')}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === h.id}
                    onClick={() => void run(h.id, async () => (await updateWebhook({ id: h.id, enabled: !h.enabled }), h.enabled ? t('ws.webhooks.pausedDone') : t('ws.webhooks.resumedDone')))}
                  >
                    {h.enabled ? t('ws.webhooks.pause') : t('ws.webhooks.resume')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === h.id}
                    aria-label={t('ws.webhooks.deleteLabel', { url: h.url })}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('ws.webhooks.deleteTitle'),
                        description: t('ws.webhooks.deleteBody', { url: h.url }),
                        confirmLabel: t('ws.webhooks.deleteConfirm'),
                        tone: 'danger',
                      })
                      if (ok) void run(h.id, async () => (await deleteWebhook(h.id), t('ws.webhooks.deleted')))
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                {h.deliveries.length > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-muted-foreground" aria-label={t('ws.webhooks.deliveries')}>
                    {h.deliveries.slice(0, 5).map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-x-1.5">
                        <span className="font-mono">{`${formatDateTime(d.createdAt, WHEN)} WIB`}</span> · <span className="font-mono">{d.event}</span> ·
                        <StateMark state={d.status === 'delivered' ? 'live' : d.status === 'failed' ? 'tripped' : 'paused'} className="text-xs">
                          {isDeliveryStatus(d.status) ? t(`ws.webhooks.status.${d.status}`) : d.status}
                          {d.responseStatus ? ` (HTTP ${d.responseStatus})` : ''}
                        </StateMark>
                        {d.status !== 'delivered' && d.error ? <span>· {d.error}</span> : null}
                        {d.attempts > 1 ? <span>· {t('ws.webhooks.attempts', { count: d.attempts })}</span> : null}
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
