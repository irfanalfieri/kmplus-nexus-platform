'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { BellRing, Check, Copy, Loader2, Plus, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { createAlertChannel, deleteAlertChannel, listAlertChannels, testAlertChannel, updateAlertChannel } from '@/lib/actions/alerts'
import { CHANNEL_KINDS, type ChannelKind } from '@/lib/alerts/rules'
import { usePrefs } from '@/components/i18n/i18n-provider'

type Channel = Awaited<ReturnType<typeof listAlertChannels>>[number]
interface Draft {
  id?: string
  name: string
  kind: ChannelKind
  url: string
  allPipelines: boolean
}

const PLACEHOLDER: Record<ChannelKind, string> = {
  slack: 'https://hooks.slack.com/services/…',
  teams: 'https://….logic.azure.com/workflows/…',
  webhook: 'https://ops.example.co.id/nexus-alerts',
}

/** MN-5: alert channels (Slack, Microsoft Teams, any webhook). */
export function AlertChannels() {
  const { t, formatDateTime } = usePrefs()
  const id = useId()
  const [channels, setChannels] = useState<Channel[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback(async () => {
    try {
      setChannels(await listAlertChannels())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.alerts.loadFailed'))
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

  const save = (d: Draft) =>
    run('save', async () => {
      if (d.id) {
        await updateAlertChannel(d.id, { name: d.name, kind: d.kind, url: d.url || undefined, allPipelines: d.allPipelines })
        setDraft(null)
        return t('ws.alerts.saved')
      }
      const res = await createAlertChannel({ name: d.name, kind: d.kind, url: d.url, allPipelines: d.allPipelines })
      setDraft(null)
      if (res.signingSecret) {
        setSecret(res.signingSecret)
        setCopied(false)
      }
      return t('ws.alerts.added')
    })

  return (
    <SettingsPanel title={t('ws.alerts.title')} description={t('ws.alerts.description')}>
      <div className="space-y-3">
        {!draft && (
          <Button onClick={() => setDraft({ name: '', kind: 'teams', url: '', allPipelines: true })}>
            <Plus aria-hidden /> {t('ws.alerts.add')}
          </Button>
        )}

        {secret && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm" role="status">
            <h3 className="font-semibold">{t('ws.alerts.secretOnce')}</h3>
            <div className="flex gap-2">
              <Input readOnly value={secret} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('ws.alerts.secretLabel')} />
              <Button size="icon" variant="outline" aria-label={copied ? t('ws.webhooks.secretCopied') : t('ws.webhooks.copySecret')} onClick={() => void navigator.clipboard.writeText(secret).then(() => setCopied(true))}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <Button variant="ghost" onClick={() => setSecret(null)}>
                {t('ws.common.done')}
              </Button>
            </div>
          </div>
        )}

        {draft && (
          <form
            className="space-y-3 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void save(draft)
            }}
          >
            <h3 className="text-sm font-semibold">{draft.id ? t('ws.alerts.editTitle') : t('ws.alerts.newTitle')}</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-name`}>{t('ws.alerts.name')}</Label>
                <Input id={`${id}-name`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('ws.alerts.namePlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-kind`}>{t('ws.alerts.kind')}</Label>
                <select id={`${id}-kind`} className={nativeSelectClass} value={draft.kind} disabled={Boolean(draft.id)} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ChannelKind })}>
                  {CHANNEL_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`ws.alerts.kinds.${k}`)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-url`}>{t('ws.alerts.url')}</Label>
              <Input id={`${id}-url`} value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} placeholder={draft.id ? t('ws.alerts.keepUrl') : PLACEHOLDER[draft.kind]} className="font-mono" />
              <p className="text-xs text-muted-foreground">{t(`ws.alerts.hints.${draft.kind}`)}</p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={draft.allPipelines} onChange={(e) => setDraft({ ...draft, allPipelines: e.target.checked })} />
              {t('ws.alerts.allPipelines')}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy === 'save' || !draft.name.trim() || (!draft.id && !draft.url.trim())}>
                {busy === 'save' && <Loader2 className="animate-spin" aria-hidden />} {t('common.save')}
              </Button>
            </div>
          </form>
        )}

        {notice && <Notice tone="info">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {!channels ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : channels.length === 0 ? (
          !draft && (
            <EmptyState compact icon={<BellRing />} title={t('ws.alerts.emptyTitle')}>
              {t('ws.alerts.emptyBody')}
            </EmptyState>
          )
        ) : (
          <ul className="space-y-2">
            {channels.map((c) => (
              <li key={c.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-medium">{c.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t(`ws.alerts.kinds.${c.kind}`)}
                      {c.host ? ` · ${c.host}` : ''} · {c.allPipelines ? t('ws.alerts.everyPipeline') : t('ws.alerts.chosenPipelines')}
                    </p>
                  </div>
                  {c.lastStatus && (
                    <StateMark state={c.lastStatus === 'sent' ? 'live' : 'tripped'} className="text-xs">
                      {c.lastStatus === 'sent' ? t('ws.alerts.lastSent') : t('ws.alerts.lastFailed')}
                      {c.lastSentAt ? ` ${formatDateTime(c.lastSentAt, { dateStyle: 'medium', timeStyle: 'short' })}` : ''}
                    </StateMark>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === c.id}
                    onClick={() =>
                      void run(c.id, async () => {
                        const r = await testAlertChannel(c.id)
                        return r.ok ? t('ws.alerts.testSent') : t('ws.alerts.testFailed', { error: r.error ?? '' })
                      })
                    }
                  >
                    <Send aria-hidden /> {t('ws.alerts.sendTest')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft({ id: c.id, name: c.name, kind: c.kind, url: '', allPipelines: c.allPipelines })}>
                    {t('common.edit')}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === c.id}
                    aria-label={t('ws.alerts.deleteLabel', { name: c.name })}
                    onClick={async () => {
                      const ok = await confirm({ title: t('ws.alerts.deleteTitle', { name: c.name }), description: t('ws.alerts.deleteBody'), confirmLabel: t('ws.alerts.deleteConfirm'), tone: 'danger' })
                      if (ok) void run(c.id, async () => (await deleteAlertChannel(c.id), t('ws.alerts.deleted')))
                    }}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                {c.lastStatus === 'failed' && c.lastError && <p className="mt-1 text-xs text-danger-text">{c.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}
