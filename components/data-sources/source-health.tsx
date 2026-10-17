'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { CheckCheck, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Modal } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { StateMark } from '@/components/ui/flow-line'
import { Table, TBody, THead, Td, Th, Tr } from '@/components/ui/data-table'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useCan } from '@/components/workspace/workspace-context'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { getSourceHealth, reviewSchemaDrift, setHealthCheckInterval, testConnection } from '@/lib/actions/data-sources'
import { HEALTH_CHECK_MINUTES, describeChange, isBreaking } from '@/lib/connectors/drift'

type Health = Awaited<ReturnType<typeof getSourceHealth>>

/**
 * DS-7 / DS-8: a data source's health checks (interval, uptime, history) and
 * the schema changes its latest scans found, with the pipelines they reach.
 */
export function SourceHealthDialog({ sourceId, onClose, onChanged }: { sourceId: string; onClose: () => void; onChanged: () => void }) {
  const { t, formatDateTime, formatNumber } = usePrefs()
  const canManage = useCan('sources:manage')
  const [data, setData] = useState<Health | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setData(await getSourceHealth(sourceId))
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('health.loadFailed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceId])
  useEffect(() => {
    void load()
  }, [load])

  const act = async (work: () => Promise<string>) => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      setNotice(await work())
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('health.loadFailed'))
    } finally {
      setBusy(false)
      await load()
    }
  }

  const when = (v: Date | string | null | undefined) => (v ? `${formatDateTime(v, { dateStyle: 'medium', timeStyle: 'short' })} WIB` : '—')
  const intervalLabel = (m: number) => (m === 0 ? t('health.off') : m < 60 ? t('health.everyMinutes', { count: m }) : m < 1440 ? t('health.everyHours', { count: m / 60 }) : t('health.daily'))
  const pct = (u: Health['day']) => (u.percent == null ? '—' : `${formatNumber(u.percent)}%`)

  return (
    <Modal title={data ? t('health.title', { name: data.name }) : t('health.titleLoading')} description={t('health.description')} size="lg" onClose={onClose}>
      {!data ? (
        error ? (
          <Notice tone="danger">{error}</Notice>
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        )
      ) : (
        <div className="space-y-4 text-sm">
          {notice && <Notice tone="success">{notice}</Notice>}
          {error && <Notice tone="danger">{error}</Notice>}

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <StateMark state={data.status === 'connected' ? 'live' : data.status === 'error' ? 'tripped' : 'idle'}>
              {data.status === 'connected' ? t('health.ok') : data.status === 'error' ? t('health.failing', { count: data.failures }) : t('health.unknown')}
            </StateMark>
            {data.day.checks > 0 && <span className="text-muted-foreground">{t('health.uptime24h', { value: pct(data.day), checks: data.day.checks })}</span>}
            {data.week.checks > 0 && <span className="text-muted-foreground">{t('health.uptime7d', { value: pct(data.week), checks: data.week.checks })}</span>}
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('health.interval')}</span>
              <select
                className={nativeSelectClass}
                value={data.intervalMinutes}
                disabled={!canManage || busy}
                onChange={(e) => void act(async () => (await setHealthCheckInterval(sourceId, Number(e.target.value)), t('health.intervalSaved')))}
              >
                {HEALTH_CHECK_MINUTES.map((m) => (
                  <option key={m} value={m}>{intervalLabel(m)}</option>
                ))}
              </select>
            </label>
            {canManage && (
              <Button variant="outline" disabled={busy} onClick={() => void act(async () => {
                const res = await testConnection(sourceId)
                return res.drift ? t('health.checkedDrift', { count: res.drift }) : t('health.checked')
              })}>
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />} {t('health.checkNow')}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {t('health.last', { when: when(data.lastCheckAt) })}
              {data.intervalMinutes > 0 && data.nextCheckAt ? ` · ${t('health.next', { when: when(data.nextCheckAt) })}` : ''}
              {` · ${t('health.scanned', { when: when(data.scannedAt) })}`}
            </p>
          </div>

          <section aria-labelledby="health-drift" className="space-y-2">
            <h3 id="health-drift" className="text-sm font-medium">{t('health.driftTitle')}</h3>
            {!data.drift ? (
              <p className="text-xs text-muted-foreground">{t('health.noDrift')}</p>
            ) : (
              <Notice tone={data.drift.affected.length ? 'warning' : 'info'}>
                <p className="font-medium">{t('health.driftFound', { when: when(data.drift.detectedAt) })}</p>
                <ul className="mt-1 list-inside list-disc font-mono text-xs">
                  {data.drift.changes.map((c) => (
                    <li key={describeChange(c)} className={isBreaking(c) ? '' : 'text-muted-foreground'}>{describeChange(c)}</li>
                  ))}
                </ul>
                {data.drift.affected.length > 0 ? (
                  <div className="mt-2 text-xs">
                    <p className="font-medium">{t('health.affected')}</p>
                    <ul className="mt-1 space-y-0.5">
                      {data.drift.affected.map((a) => (
                        <li key={a.pipelineId}>
                          <Link href="/dashboard/pipelines" className="font-medium text-info-text underline-offset-2 hover:underline">{a.name}</Link>
                          <span className="text-muted-foreground">: {a.changes.join('; ')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="mt-2 text-xs">{t('health.noneAffected')}</p>
                )}
                {canManage && (
                  <Button size="sm" variant="outline" className="mt-3" disabled={busy} onClick={() => void act(async () => (await reviewSchemaDrift(sourceId), t('health.reviewed')))}>
                    <CheckCheck aria-hidden /> {t('health.markReviewed')}
                  </Button>
                )}
              </Notice>
            )}
          </section>

          <section aria-labelledby="health-history">
            <h3 id="health-history" className="mb-2 text-sm font-medium">{t('health.history')}</h3>
            {!data.checks.length ? (
              <p className="text-xs text-muted-foreground">{t('health.noChecks')}</p>
            ) : (
              <div className="max-h-72 overflow-auto rounded-md border border-border">
                <Table label={t('health.history')}>
                  <THead className="sticky top-0 z-10 bg-muted">
                    <tr>
                      <Th>{t('health.colWhen')}</Th>
                      <Th>{t('health.colResult')}</Th>
                      <Th className="text-right">{t('health.colTime')}</Th>
                      <Th>{t('health.colMessage')}</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {data.checks.map((c) => (
                      <Tr key={c.id}>
                        <Td className="py-1 font-mono text-xs whitespace-nowrap">
                          {when(c.checkedAt)}
                          {c.trigger === 'manual' && <span className="ml-1 font-sans text-muted-foreground">{t('health.manual')}</span>}
                        </Td>
                        <Td className="py-1">
                          <StateMark state={c.ok ? 'live' : 'tripped'} className="text-xs">{c.ok ? t('health.pass') : t('health.fail')}</StateMark>
                        </Td>
                        <Td className="py-1 text-right font-mono text-xs">{c.latencyMs != null ? `${formatNumber(c.latencyMs)} ms` : '—'}</Td>
                        <Td className="py-1 text-xs break-words">
                          {c.message || '—'}
                          {c.scanned && <span className="ml-1 text-muted-foreground">{t('health.withScan')}</span>}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
