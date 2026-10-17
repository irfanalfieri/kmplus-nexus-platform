'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Modal, useConfirm } from '@/components/ui/dialog'
import { Notice } from '@/components/ui/notice'
import { StateMark } from '@/components/ui/flow-line'
import { useToast } from '@/components/ui/toast'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { nativeSelectClass } from '@/components/workspace/settings-panel'
import { createDashboardEmbed, listDashboardEmbeds, revokeDashboardEmbed, setDashboardSharing } from '@/lib/actions/analytics'
import { listMembers } from '@/lib/actions/workspaces'
import { ROLES } from '@/lib/auth/permissions'
import { EMBED_ROLES, type DashboardSharing } from '@/lib/analytics/sharing'

type Members = Awaited<ReturnType<typeof listMembers>>

/** DB-5: who sees a dashboard. */
export function ShareDashboardDialog({ dashboardId, name, sharing, onClose, onSaved }: { dashboardId: string; name: string; sharing: DashboardSharing; onClose: () => void; onSaved: () => void }) {
  const { t } = usePrefs()
  const toast = useToast()
  const [draft, setDraft] = useState<DashboardSharing>(sharing)
  const [members, setMembers] = useState<Members>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    listMembers().then(setMembers).catch(() => undefined)
  }, [])
  const dirty = JSON.stringify(draft) !== JSON.stringify(sharing)
  const toggle = <T,>(list: T[], v: T, on: boolean) => (on ? Array.from(new Set([...list, v])) : list.filter((x) => x !== v))
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await setDashboardSharing(dashboardId, draft)
      toast({ message: t('insights.share.saved') })
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.share.failed'))
      setBusy(false)
    }
  }
  const chip = 'flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs has-[:checked]:border-ring has-[:checked]:bg-accent'
  return (
    <Modal
      title={t('insights.share.title', { name })}
      description={t('insights.share.description')}
      onClose={onClose}
      dirty={dirty}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => void save()} disabled={busy || !dirty}>
            {busy && <Loader2 className="animate-spin" aria-hidden />} {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        <fieldset className="space-y-2">
          <legend className="sr-only">{t('insights.share.who')}</legend>
          <label className="flex items-start gap-2">
            <input type="radio" name="share-mode" className="mt-1 accent-primary" checked={draft.mode === 'workspace'} onChange={() => setDraft({ ...draft, mode: 'workspace' })} />
            <span>
              <span className="font-medium">{t('insights.share.workspace')}</span>
              <span className="block text-xs text-muted-foreground">{t('insights.share.workspaceHint')}</span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input type="radio" name="share-mode" className="mt-1 accent-primary" checked={draft.mode === 'restricted'} onChange={() => setDraft({ ...draft, mode: 'restricted' })} />
            <span>
              <span className="font-medium">{t('insights.share.restricted')}</span>
              <span className="block text-xs text-muted-foreground">{t('insights.share.restrictedHint')}</span>
            </span>
          </label>
        </fieldset>
        {draft.mode === 'restricted' && (
          <>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('insights.share.roles')}</legend>
              <div className="flex flex-wrap gap-1.5">
                {ROLES.filter((r) => r !== 'admin').map((r) => (
                  <label key={r} className={chip}>
                    <input type="checkbox" className="accent-primary" checked={draft.roles.includes(r)} onChange={(e) => setDraft({ ...draft, roles: toggle(draft.roles, r, e.target.checked) })} />
                    {t(`ws.roles.${r}` as const)}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-1 text-xs font-medium text-muted-foreground">{t('insights.share.people')}</legend>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {members.map((m) => (
                  <label key={m.userId} className={chip}>
                    <input type="checkbox" className="accent-primary" checked={draft.userIds.includes(m.userId)} onChange={(e) => setDraft({ ...draft, userIds: toggle(draft.userIds, m.userId, e.target.checked) })} />
                    {m.name || m.email}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  )
}

type Embeds = Awaited<ReturnType<typeof listDashboardEmbeds>>

/** DB-5: secret links that show the dashboard inside KMPlus apps (admins). */
export function EmbedDashboardDialog({ dashboardId, name, filterIds, onClose }: { dashboardId: string; name: string; filterIds: string[]; onClose: () => void }) {
  const { t, formatDateTime } = usePrefs()
  const [embeds, setEmbeds] = useState<Embeds | null>(null)
  const [adding, setAdding] = useState(false)
  const [label, setLabel] = useState('')
  const [role, setRole] = useState<(typeof EMBED_ROLES)[number]>('viewer')
  const [origins, setOrigins] = useState('https://kms.kmplus.co.id')
  const [days, setDays] = useState('90')
  const [url, setUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirm, confirmEl] = useConfirm()
  const load = useCallback(async () => {
    try {
      setEmbeds(await listDashboardEmbeds(dashboardId))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.embed.failed'))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dashboardId])
  useEffect(() => {
    void load()
  }, [load])
  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await createDashboardEmbed(dashboardId, {
        label,
        role,
        allowedOrigins: origins.split(/[\s,]+/).filter(Boolean),
        expiresInDays: days ? Number(days) : null,
      })
      setUrl(res.url)
      setCopied(false)
      setAdding(false)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.embed.failed'))
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (id: string) => {
    if (!(await confirm({ title: t('insights.embed.revokeTitle'), description: t('insights.embed.revokeBody'), confirmLabel: t('insights.embed.revoke'), tone: 'danger' }))) return
    try {
      await revokeDashboardEmbed(id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('insights.embed.failed'))
    }
  }
  const snippet = url ? `<iframe src="${url}${filterIds.length ? `?lang=id&f.${filterIds[0]}=…` : '?lang=id'}" width="100%" height="720" style="border:0" title="${name.replace(/"/g, '')}"></iframe>` : ''
  return (
    <Modal title={t('insights.embed.title', { name })} description={t('insights.embed.description')} size="lg" onClose={onClose} dirty={adding}>
      {confirmEl}
      <div className="space-y-3 text-sm">
        {error && <Notice tone="danger">{error}</Notice>}
        {url && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3" role="status">
            <h3 className="font-semibold">{t('insights.embed.copyNow')}</h3>
            <div className="flex gap-2">
              <Input readOnly value={url} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('insights.embed.url')} />
              <Button size="icon" variant="outline" aria-label={copied ? t('insights.embed.copied') : t('insights.embed.copy')} onClick={() => void navigator.clipboard.writeText(url).then(() => setCopied(true))}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
            <Label htmlFor="embed-snippet" className="text-xs">{t('insights.embed.snippet')}</Label>
            <textarea id="embed-snippet" readOnly rows={3} value={snippet} className="w-full rounded-md border border-input bg-card px-2 py-1.5 font-mono text-xs" onFocus={(e) => e.target.select()} />
            <p className="text-xs text-muted-foreground">{t('insights.embed.params')}</p>
          </div>
        )}
        {!adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <Plus aria-hidden /> {t('insights.embed.add')}
          </Button>
        ) : (
          <fieldset className="space-y-3 rounded-md border border-border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">{t('insights.embed.newTitle')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.embed.label')}</span>
                <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t('insights.embed.labelPlaceholder')} />
              </label>
              <label>
                <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.embed.role')}</span>
                <select className={nativeSelectClass} value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
                  {EMBED_ROLES.map((r) => (
                    <option key={r} value={r}>{t(`ws.roles.${r}` as const)}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.embed.origins')}</span>
              <Input value={origins} onChange={(e) => setOrigins(e.target.value)} className="font-mono text-xs" placeholder="https://kms.kmplus.co.id https://*.kmplus.co.id" />
              <span className="mt-1 block text-xs text-muted-foreground">{t('insights.embed.originsHint')}</span>
            </label>
            <label className="block max-w-[200px]">
              <span className="mb-1 block text-xs font-medium text-muted-foreground">{t('insights.embed.expires')}</span>
              <select className={nativeSelectClass} value={days} onChange={(e) => setDays(e.target.value)}>
                {['30', '90', '365', ''].map((d) => (
                  <option key={d} value={d}>{d ? t('insights.embed.days', { count: Number(d) }) : t('insights.embed.never')}</option>
                ))}
              </select>
            </label>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy || !origins.trim()} onClick={() => void create()}>
                {busy && <Loader2 className="animate-spin" aria-hidden />} {t('insights.embed.create')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>{t('common.cancel')}</Button>
            </div>
          </fieldset>
        )}
        {!embeds ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />
        ) : embeds.length === 0 ? (
          <p className="text-muted-foreground">{t('insights.embed.empty')}</p>
        ) : (
          <ul className="space-y-2">
            {embeds.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{e.label || t('insights.embed.unnamed')}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {t(`ws.roles.${e.role as (typeof EMBED_ROLES)[number]}` as const)} · <span className="font-mono">{e.allowedOrigins.join(' ')}</span> · {t('insights.embed.views', { count: e.views })}
                    {e.expiresAt ? ` · ${t('insights.embed.until', { when: formatDateTime(e.expiresAt, { dateStyle: 'medium' }) })}` : ''}
                  </p>
                </div>
                <StateMark state={e.usable ? 'live' : 'idle'} className="text-xs">
                  {e.usable ? t('insights.embed.active') : e.revokedAt ? t('insights.embed.revoked') : t('insights.embed.expired')}
                </StateMark>
                {e.usable && (
                  <Button size="sm" variant="destructive" onClick={() => void revoke(e.id)}>
                    {t('insights.embed.revoke')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}
