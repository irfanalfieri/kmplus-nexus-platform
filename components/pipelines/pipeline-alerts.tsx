'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { BellRing, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { useToast } from '@/components/ui/toast'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useCan } from '@/components/workspace/workspace-context'
import { getPipelineAlerts, savePipelineAlerts, setPipelineSubscription } from '@/lib/actions/alerts'
import type { PipelineAlerts } from '@/lib/alerts/rules'
import { settingsHref } from '@/lib/navigation'

type Data = Awaited<ReturnType<typeof getPipelineAlerts>>

const numberOrNull = (v: string) => (v.trim() === '' ? null : Number(v))

/** MN-5: a pipeline's subscribers, channels, SLA and error-rate alerts. */
export function PipelineAlertsDialog({ pipelineId, pipelineName, onClose }: { pipelineId: string; pipelineName: string; onClose: () => void }) {
  const { t, formatDateTime } = usePrefs()
  const id = useId()
  const toast = useToast()
  const canEdit = useCan('pipelines:run')
  const canManageChannels = useCan('workspace:manage')
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<PipelineAlerts | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getPipelineAlerts(pipelineId)
      .then((d) => {
        setData(d)
        setDraft(d.config)
      })
      .catch((err) => setError(err instanceof Error ? err.message : t('pipelines.alerts.failed')))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId])

  const dirty = Boolean(data && draft && JSON.stringify(data.config) !== JSON.stringify(draft))

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const saved = await savePipelineAlerts(pipelineId, draft)
      setData((d) => (d ? { ...d, config: saved } : d))
      setDraft(saved)
      toast({ message: t('pipelines.alerts.saved') })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.alerts.failed'))
    } finally {
      setBusy(false)
    }
  }

  const subscribe = async (on: boolean) => {
    setBusy(true)
    setError('')
    try {
      await setPipelineSubscription(pipelineId, on)
      const fresh = await getPipelineAlerts(pipelineId)
      setData(fresh)
      setDraft(fresh.config)
      toast({ message: on ? t('pipelines.alerts.subscribedToast') : t('pipelines.alerts.unsubscribedToast') })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.alerts.failed'))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (list: string[], value: string, on: boolean) => (on ? Array.from(new Set([...list, value])) : list.filter((x) => x !== value))
  const field = 'mb-1 block text-xs font-medium text-muted-foreground'

  return (
    <Modal
      title={t('pipelines.alerts.title', { name: pipelineName })}
      description={t('pipelines.alerts.description')}
      size="lg"
      onClose={onClose}
      dirty={dirty}
      footer={
        canEdit && draft ? (
          <>
            <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
            <Button onClick={() => void save()} disabled={busy || !dirty}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} {t('common.save')}
            </Button>
          </>
        ) : undefined
      }
    >
      <div className="space-y-4 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        {!data || !draft ? (
          !error && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
              <BellRing className="size-4 text-muted-foreground" aria-hidden />
              <p className="min-w-0 flex-1">{data.subscribed ? t('pipelines.alerts.youSubscribed') : t('pipelines.alerts.youNotSubscribed')}</p>
              <Button size="sm" variant="outline" disabled={busy || dirty} onClick={() => void subscribe(!data.subscribed)}>
                {data.subscribed ? t('pipelines.alerts.unsubscribe') : t('pipelines.alerts.subscribe')}
              </Button>
            </div>

            <fieldset disabled={!canEdit} className="space-y-4">
              <section className="space-y-2">
                <h3 className="font-semibold">{t('pipelines.alerts.whenTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('pipelines.alerts.whenBody')}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  <label>
                    <span className={field}>{t('pipelines.alerts.errorRate')}</span>
                    <Input type="number" min={0.1} max={100} step={0.1} inputMode="decimal" value={draft.errorRatePercent ?? ''} placeholder={t('pipelines.alerts.off')} onChange={(e) => setDraft({ ...draft, errorRatePercent: numberOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span className={field}>{t('pipelines.alerts.maxDuration')}</span>
                    <Input type="number" min={5} max={1440} step={1} inputMode="numeric" value={draft.maxDurationMinutes ?? ''} placeholder={t('pipelines.alerts.off')} onChange={(e) => setDraft({ ...draft, maxDurationMinutes: numberOrNull(e.target.value) })} />
                  </label>
                  <label>
                    <span className={field}>{t('pipelines.alerts.stale')}</span>
                    <Input type="number" min={1} max={744} step={1} inputMode="numeric" value={draft.staleHours ?? ''} placeholder={t('pipelines.alerts.off')} onChange={(e) => setDraft({ ...draft, staleHours: numberOrNull(e.target.value) })} />
                  </label>
                </div>
                <p className="text-xs text-muted-foreground">
                  {data.lastSuccessAt ? t('pipelines.alerts.lastSuccess', { when: formatDateTime(data.lastSuccessAt, { dateStyle: 'medium', timeStyle: 'short' }) }) : t('pipelines.alerts.noSuccess')}
                </p>
              </section>

              <section className="space-y-2">
                <h3 className="font-semibold">{t('pipelines.alerts.channelsTitle')}</h3>
                {data.channels.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t('pipelines.alerts.noChannels')}{' '}
                    {canManageChannels && (
                      <Link href={settingsHref('alerts')} className="underline underline-offset-2">
                        {t('pipelines.alerts.setUpChannels')}
                      </Link>
                    )}
                  </p>
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {data.channels.map((c) => (
                      <li key={c.id}>
                        <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-ring has-[:checked]:bg-accent">
                          <input
                            type="checkbox"
                            className="accent-primary"
                            checked={c.allPipelines || draft.channelIds.includes(c.id)}
                            disabled={c.allPipelines}
                            onChange={(e) => setDraft({ ...draft, channelIds: toggle(draft.channelIds, c.id, e.target.checked) })}
                          />
                          {c.name} · {t(`ws.alerts.kinds.${c.kind}`)}
                          {c.allPipelines && <span className="text-muted-foreground">({t('pipelines.alerts.everyPipeline')})</span>}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="space-y-2">
                <h3 id={`${id}-subs`} className="font-semibold">{t('pipelines.alerts.subscribersTitle')}</h3>
                <p className="text-xs text-muted-foreground">{t('pipelines.alerts.subscribersBody')}</p>
                <ul aria-labelledby={`${id}-subs`} className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                  {data.members.map((m) => (
                    <li key={m.id}>
                      <label className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-ring has-[:checked]:bg-accent">
                        <input type="checkbox" className="accent-primary" checked={draft.subscribers.includes(m.id)} onChange={(e) => setDraft({ ...draft, subscribers: toggle(draft.subscribers, m.id, e.target.checked) })} />
                        {m.name || m.email}
                      </label>
                    </li>
                  ))}
                </ul>
              </section>
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  )
}
