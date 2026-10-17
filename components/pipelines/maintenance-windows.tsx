'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { useCan } from '@/components/workspace/workspace-context'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { deleteMaintenanceWindow, listMaintenanceWindows, saveMaintenanceWindow } from '@/lib/actions/maintenance'
import { WEEKDAYS, activeWindow, type MaintenanceWindow } from '@/lib/pipelines/maintenance'

type Data = Awaited<ReturnType<typeof listMaintenanceWindows>>
type Draft = Omit<MaintenanceWindow, 'id'> & { id?: string }

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

const blank = (): Draft => ({ name: '', kind: 'weekly', days: [0], startTime: '01:00', endTime: '05:00', action: 'defer', pipelineIds: [] })

/** SC-4: a notice while a window holds every pipeline's automatic runs (shown on the Pipelines page). */
export function ActiveMaintenanceNotice({ refreshKey }: { refreshKey?: number }) {
  const { t, formatDateTime } = usePrefs()
  const [data, setData] = useState<Data | null>(null)
  useEffect(() => {
    void listMaintenanceWindows().then(setData).catch(() => undefined)
  }, [refreshKey])
  const all = data?.windows.filter((w) => !w.pipelineIds.length) ?? []
  const active = activeWindow(all, '*')
  const some = data?.windows.filter((w) => w.pipelineIds.length && activeWindow([w], w.pipelineIds[0])) ?? []
  if (!active && !some.length) return null
  return (
    <Notice tone="held" live={false}>
      {active
        ? t('pipelines.maintenance.activeAll', { name: active.window.name, until: `${formatDateTime(active.endsAt, { dateStyle: 'medium', timeStyle: 'short' })} WIB` })
        : t('pipelines.maintenance.activeSome', { names: some.map((w) => w.name).join(', ') })}
    </Notice>
  )
}

/** SC-4: maintenance windows and blackout dates for automatic runs. */
export function MaintenanceWindowsDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = usePrefs()
  const canManage = useCan('pipelines:run')
  const [data, setData] = useState<Data | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    try {
      setData(await listMaintenanceWindows())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.maintenance.failed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!draft) return
    setBusy(true)
    setError('')
    try {
      const { id, ...window } = draft
      await saveMaintenanceWindow({ id, window })
      setDraft(null)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.maintenance.failed'))
    } finally {
      setBusy(false)
    }
  }
  const remove = async (w: MaintenanceWindow) => {
    if (!(await confirm({ title: t('pipelines.maintenance.deleteTitle', { name: w.name }), description: t('pipelines.maintenance.deleteBody'), confirmLabel: t('pipelines.maintenance.delete'), tone: 'danger' }))) return
    try {
      await deleteMaintenanceWindow(w.id)
      await load()
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('pipelines.maintenance.failed'))
    }
  }
  const dayName = (d: number) => t(`pipelines.maintenance.days.${DAY_KEYS[d]}`)
  const describe = (w: MaintenanceWindow) =>
    w.kind === 'once'
      ? t('pipelines.maintenance.onceText', { from: w.startsAt!.replace('T', ' '), to: w.endsAt!.replace('T', ' ') })
      : t('pipelines.maintenance.weeklyText', { days: w.days.map(dayName).join(', '), from: w.startTime!, to: w.endTime! })
  const scopeText = (w: MaintenanceWindow) => (w.pipelineIds.length ? w.pipelineIds.map((id) => data?.pipelines.find((p) => p.id === id)?.name ?? id).join(', ') : t('pipelines.maintenance.allPipelines'))

  return (
    <Modal title={t('pipelines.maintenance.title')} description={t('pipelines.maintenance.description')} size="lg" onClose={onClose} dirty={Boolean(draft)}>
      {confirmDialog}
      <div className="space-y-3 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        {!data ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : (
          <>
            {!data.windows.length && !draft && <p className="text-muted-foreground">{t('pipelines.maintenance.empty')}</p>}
            <ul className="space-y-2">
              {data.windows.map((w) => (
                <li key={w.id} className="flex flex-wrap items-start gap-2 rounded-md border border-border p-3">
                  <CalendarOff className="mt-0.5 size-4 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{w.name}</p>
                    <p className="text-xs text-muted-foreground">{describe(w)} · {t(`pipelines.maintenance.actions.${w.action}`)} · {scopeText(w)}</p>
                  </div>
                  {canManage && (
                    <>
                      <Button size="icon-sm" variant="ghost" onClick={() => setDraft({ ...w })} aria-label={t('pipelines.maintenance.edit', { name: w.name })}><Pencil aria-hidden /></Button>
                      <Button size="icon-sm" variant="ghost" onClick={() => void remove(w)} aria-label={t('pipelines.maintenance.deleteNamed', { name: w.name })}><Trash2 aria-hidden /></Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            {canManage && !draft && (
              <Button size="sm" variant="outline" onClick={() => setDraft(blank())}>
                <Plus aria-hidden /> {t('pipelines.maintenance.add')}
              </Button>
            )}
            {draft && (
              <fieldset className="space-y-3 rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-medium text-muted-foreground">{draft.id ? t('pipelines.maintenance.editTitle') : t('pipelines.maintenance.addTitle')}</legend>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.name')}</span>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t('pipelines.maintenance.namePlaceholder')} />
                </label>
                <div className="flex flex-wrap gap-3">
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.kind')}</span>
                    <select className={nativeSelectClass} value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as Draft['kind'] })}>
                      <option value="weekly">{t('pipelines.maintenance.weekly')}</option>
                      <option value="once">{t('pipelines.maintenance.once')}</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.action')}</span>
                    <select className={nativeSelectClass} value={draft.action} onChange={(e) => setDraft({ ...draft, action: e.target.value as Draft['action'] })}>
                      <option value="defer">{t('pipelines.maintenance.actions.defer')}</option>
                      <option value="skip">{t('pipelines.maintenance.actions.skip')}</option>
                    </select>
                  </label>
                </div>
                {draft.kind === 'once' ? (
                  <div className="flex flex-wrap gap-3">
                    <label>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.startsAt')}</span>
                      <Input type="datetime-local" value={draft.startsAt ?? ''} onChange={(e) => setDraft({ ...draft, startsAt: e.target.value || undefined })} />
                    </label>
                    <label>
                      <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.endsAt')}</span>
                      <Input type="datetime-local" value={draft.endsAt ?? ''} onChange={(e) => setDraft({ ...draft, endsAt: e.target.value || undefined })} />
                    </label>
                  </div>
                ) : (
                  <>
                    <fieldset className="flex flex-wrap gap-2">
                      <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.daysLabel')}</legend>
                      {WEEKDAYS.map((d) => (
                        <label key={d} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-ring has-[:checked]:bg-accent">
                          <input type="checkbox" className="accent-primary" checked={draft.days.includes(d)} onChange={(e) => setDraft({ ...draft, days: e.target.checked ? [...draft.days, d].sort() : draft.days.filter((x) => x !== d) })} />
                          {dayName(d)}
                        </label>
                      ))}
                    </fieldset>
                    <div className="flex flex-wrap gap-3">
                      <label>
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.from')}</span>
                        <Input type="time" value={draft.startTime ?? ''} onChange={(e) => setDraft({ ...draft, startTime: e.target.value || undefined })} />
                      </label>
                      <label>
                        <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.to')}</span>
                        <Input type="time" value={draft.endTime ?? ''} onChange={(e) => setDraft({ ...draft, endTime: e.target.value || undefined })} />
                      </label>
                    </div>
                  </>
                )}
                <fieldset>
                  <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('pipelines.maintenance.pipelines')}</legend>
                  <label className="mb-1 flex items-center gap-2 text-xs">
                    <input type="checkbox" className="accent-primary" checked={!draft.pipelineIds.length} onChange={(e) => setDraft({ ...draft, pipelineIds: e.target.checked ? [] : data.pipelines.slice(0, 1).map((p) => p.id) })} />
                    {t('pipelines.maintenance.allPipelines')}
                  </label>
                  {draft.pipelineIds.length > 0 && (
                    <div className="flex max-h-32 flex-wrap gap-1.5 overflow-auto">
                      {data.pipelines.map((p) => (
                        <label key={p.id} className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-ring has-[:checked]:bg-accent">
                          <input type="checkbox" className="accent-primary" checked={draft.pipelineIds.includes(p.id)} onChange={(e) => setDraft({ ...draft, pipelineIds: e.target.checked ? [...draft.pipelineIds, p.id] : draft.pipelineIds.filter((x) => x !== p.id) })} />
                          {p.name}
                        </label>
                      ))}
                    </div>
                  )}
                </fieldset>
                <p className="text-xs text-muted-foreground">{t('pipelines.maintenance.timesNote')}</p>
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy || !draft.name.trim()} onClick={() => void save()}>
                    {busy && <Loader2 className="animate-spin" aria-hidden />} {t('common.save')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</Button>
                </div>
              </fieldset>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}
