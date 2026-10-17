'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Loader2 } from 'lucide-react'
import { Notice } from '@/components/ui/notice'
import { StateMark, type FlowState } from '@/components/ui/flow-line'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { cn } from '@/lib/utils'
import { compareVersions } from '@/lib/actions/pipelines'
import { localizeStepTitle } from './step-title'
import type { StepStatus } from '@/lib/pipelines/version-diff'
import type { MessageKey } from '@/lib/i18n/translate'

type Diff = Awaited<ReturnType<typeof compareVersions>>['diff']

const STATE: Record<StepStatus, FlowState> = { added: 'live', removed: 'tripped', changed: 'held', same: 'idle' }
const STATUS_KEY: Record<StepStatus, MessageKey> = {
  added: 'editor.history.compare.added',
  removed: 'editor.history.compare.removed',
  changed: 'editor.history.compare.changed',
  same: 'editor.history.compare.same',
}

/** VC-3: two versions side by side as a list of steps marked added, removed or changed, with field mapping changes. */
export function VersionCompare({ pipelineId, versions }: { pipelineId: string; versions: number[] }) {
  const { t } = usePrefs()
  const sorted = [...versions].sort((a, b) => b - a)
  const [to, setTo] = useState(sorted[0] ?? 1)
  const [from, setFrom] = useState(sorted[1] ?? 0)
  const [diff, setDiff] = useState<Diff | null>(null)
  const [error, setError] = useState('')
  const [showSame, setShowSame] = useState(false)

  useEffect(() => {
    if (!to) return
    let cancelled = false
    setDiff(null)
    setError('')
    compareVersions(pipelineId, from, to)
      .then((r) => !cancelled && setDiff(r.diff))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : t('editor.history.compare.failed')))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pipelineId, from, to])

  const title = (s: { title: string }) => localizeStepTitle(s.title, t)
  const steps = diff?.steps.filter((s) => showSame || s.status !== 'same') ?? []
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 text-sm">
      <div className="flex flex-wrap items-end gap-2">
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('editor.history.compare.from')}</span>
          <select className={nativeSelectClass} value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            <option value={0}>{t('editor.history.compare.nothing')}</option>
            {sorted.filter((v) => v < to).map((v) => (
              <option key={v} value={v}>v{v}</option>
            ))}
          </select>
        </label>
        <ArrowRight className="mb-2 size-4 text-muted-foreground" aria-hidden />
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('editor.history.compare.to')}</span>
          <select className={nativeSelectClass} value={to} onChange={(e) => {
            const v = Number(e.target.value)
            setTo(v)
            if (from >= v) setFrom(sorted.find((x) => x < v) ?? 0)
          }}>
            {sorted.map((v) => (
              <option key={v} value={v}>v{v}</option>
            ))}
          </select>
        </label>
        {diff && (
          <p className="ml-auto text-xs text-muted-foreground" role="status">
            {t('editor.history.compare.summary', { added: diff.summary.added, removed: diff.summary.removed, changed: diff.summary.changed, same: diff.summary.same })}
          </p>
        )}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {!diff && !error && (
        <p className="flex items-center gap-2 text-muted-foreground" role="status">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
        </p>
      )}
      {diff && (
        <>
          {diff.summary.added + diff.summary.removed + diff.summary.changed === 0 && !diff.edges.added.length && !diff.edges.removed.length && !diff.settings.length && !diff.schedule.length && (
            <Notice tone="info">{t('editor.history.compare.identical')}</Notice>
          )}
          <ol className="space-y-2" aria-label={t('editor.history.compare.steps')}>
            {steps.map((s) => (
              <li key={s.id} className={cn('rounded-md border p-3', s.status === 'added' ? 'border-live/40 bg-live-soft/40' : s.status === 'removed' ? 'border-danger/40 bg-danger-soft/40' : s.status === 'changed' ? 'border-held/40 bg-held-soft/30' : 'border-border')}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('font-medium', s.status === 'removed' && 'line-through')}>{title(s)}</span>
                  <StateMark state={STATE[s.status]} className="text-xs">{t(STATUS_KEY[s.status])}</StateMark>
                </div>
                {s.changes.length > 0 && (
                  <ul className="mt-2 space-y-0.5 font-mono text-xs">
                    {s.changes.slice(0, 30).map((c, i) => (
                      <li key={i} className="break-all">
                        <span className="text-muted-foreground">{c.path}:</span> <span className="text-danger-text line-through">{c.from}</span> → <span className="text-live-text">{c.to}</span>
                      </li>
                    ))}
                    {s.changes.length > 30 && <li className="text-muted-foreground">{t('editor.history.compare.more', { count: s.changes.length - 30 })}</li>}
                  </ul>
                )}
                {s.mapping.length > 0 && (
                  <table className="mt-2 w-full text-xs">
                    <caption className="sr-only">{t('editor.history.compare.mapping', { step: title(s) })}</caption>
                    <thead>
                      <tr className="text-left text-muted-foreground">
                        <th className="py-0.5 pr-2 font-medium">{t('editor.history.compare.field')}</th>
                        <th className="py-0.5 pr-2 font-medium">{t('editor.history.compare.before')}</th>
                        <th className="py-0.5 font-medium">{t('editor.history.compare.after')}</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {s.mapping.map((m) => (
                        <tr key={m.field} className="border-t border-border/60">
                          <td className="py-0.5 pr-2">{m.field} <span className="font-sans text-muted-foreground">({t(STATUS_KEY[m.kind])})</span></td>
                          <td className="py-0.5 pr-2 text-danger-text">{m.from ?? '—'}</td>
                          <td className="py-0.5 text-live-text">{m.to ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </li>
            ))}
          </ol>
          {diff.summary.same > 0 && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={showSame} onChange={(e) => setShowSame(e.target.checked)} />
              {t('editor.history.compare.showSame', { count: diff.summary.same })}
            </label>
          )}
          {(diff.edges.added.length > 0 || diff.edges.removed.length > 0) && (
            <section aria-label={t('editor.history.compare.connections')}>
              <h4 className="mb-1 text-xs font-medium text-muted-foreground">{t('editor.history.compare.connections')}</h4>
              <ul className="space-y-0.5 text-xs">
                {diff.edges.added.map((e) => <li key={`a${e}`} className="text-live-text">+ {e}</li>)}
                {diff.edges.removed.map((e) => <li key={`r${e}`} className="text-danger-text">− {e}</li>)}
              </ul>
            </section>
          )}
          {[...diff.settings.map((c) => ({ ...c, group: t('editor.history.compare.settings') })), ...diff.schedule.map((c) => ({ ...c, group: t('editor.history.compare.schedule') }))].length > 0 && (
            <ul className="space-y-0.5 font-mono text-xs">
              {[...diff.settings.map((c) => ({ ...c, group: t('editor.history.compare.settings') })), ...diff.schedule.map((c) => ({ ...c, group: t('editor.history.compare.schedule') }))].map((c, i) => (
                <li key={i} className="break-all">
                  <span className="font-sans text-muted-foreground">{c.group} · {c.path}:</span> <span className="text-danger-text line-through">{c.from}</span> → <span className="text-live-text">{c.to}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
