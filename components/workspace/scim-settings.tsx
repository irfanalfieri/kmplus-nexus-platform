'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { createScimToken, getScimOverview, revokeScimToken, setScimGroupRole } from '@/lib/actions/scim'
import { ROLES, type Role } from '@/lib/auth/permissions'
import { useT, usePrefs } from '@/components/i18n/i18n-provider'

type Overview = Awaited<ReturnType<typeof getScimOverview>>

/** Short date and time in WIB, in the interface language. */
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }

function Copyable({ value, label, id }: { value: string; label: string; id?: string }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-1">
      <Input id={id} readOnly value={value} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={id ? undefined : label} />
      <Button size="icon" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={copied ? t('ws.common.copiedLabel', { label }) : t('ws.common.copyLabel', { label })}>
        {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
      </Button>
    </div>
  )
}

/**
 * SCIM provisioning (GV-8): the identity provider adds, updates and removes
 * members automatically; IdP groups can carry Nexus roles.
 */
export function ScimSettings() {
  const { t, formatDateTime } = usePrefs()
  const when = (v: Date | string) => `${formatDateTime(v, WHEN)} WIB`
  const id = useId()
  const [data, setData] = useState<Overview | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback(async () => {
    try {
      setData(await getScimOverview())
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('ws.scim.loadFailed') })
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setMessage(null)
    try {
      const text = await fn()
      if (text) setMessage({ kind: 'ok', text })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('ws.common.failed') })
    } finally {
      setBusy(false)
    }
  }

  const active = data?.tokens.filter((tok) => !tok.revokedAt) ?? []

  return (
    <SettingsPanel
      title={t('ws.scim.title')}
      description={t('ws.scim.description')}
    >
      <div className="space-y-4">
        {!data ? (
          message?.kind === 'err' ? null : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
            </p>
          )
        ) : (
          <>
            <div className="max-w-xl space-y-1.5">
              <Label htmlFor={`${id}-base`}>{t('ws.scim.baseUrl')}</Label>
              <Copyable id={`${id}-base`} value={data.baseUrl} label={t('ws.scim.baseUrlCopy')} />
            </div>

            {created && (
              <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-xs">
                <h3 className="text-sm font-semibold">{t('ws.scim.tokenOnce')}</h3>
                <Copyable value={created} label={t('ws.scim.tokenLabel')} />
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  {t('ws.common.done')}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">{t('ws.scim.tokens')}</h3>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim()) return
                  void act(async () => (setCreated((await createScimToken(name)).token), setName(''), ''))
                }}
              >
                <Label htmlFor={`${id}-name`} className="sr-only">
                  {t('ws.scim.tokenName')}
                </Label>
                <Input id={`${id}-name`} className="w-72 max-w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ws.scim.tokenPlaceholder')} />
                <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                  <Plus aria-hidden /> {t('ws.scim.createToken')}
                </Button>
              </form>
              {data.tokens.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={t('ws.scim.tokensList')}>
                  {data.tokens.map((tok) => (
                    <li key={tok.id} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-medium">{tok.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{tok.prefix}…</span>
                      <StateMark state={tok.revokedAt ? 'tripped' : 'live'} className="text-xs">
                        {tok.revokedAt ? t('ws.common.revoked') : t('ws.common.active')}
                      </StateMark>
                      <span className="font-mono text-xs text-muted-foreground">
                        {tok.revokedAt ? when(tok.revokedAt) : t('ws.common.lastUsed', { when: tok.lastUsedAt ? when(tok.lastUsedAt) : t('ws.common.never') })}
                      </span>
                      {!tok.revokedAt && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="ml-auto"
                          disabled={busy}
                          aria-label={t('ws.scim.revokeLabel', { name: tok.name })}
                          onClick={async () => {
                            const ok = await confirm({
                              title: t('ws.scim.revokeTitle', { name: tok.name }),
                              description: t('ws.scim.revokeBody'),
                              confirmLabel: t('ws.scim.revokeConfirm'),
                              tone: 'danger',
                            })
                            if (ok) void act(async () => (await revokeScimToken(tok.id), t('ws.scim.revokedDone')))
                          }}
                        >
                          {t('ws.common.revoke')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!active.length && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StateMark state="idle" className="text-xs">
                    {t('ws.scim.off')}
                  </StateMark>
                  {t('ws.scim.noActive')}
                </p>
              )}
            </div>

            {data.groups.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">{t('ws.scim.groupsTitle')}</h3>
                <p className="mb-2 text-xs text-muted-foreground">{t('ws.scim.groupsHelp')}</p>
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                  {data.groups.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-medium">{g.displayName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t('ws.scim.members', { count: g.members })}
                      </span>
                      <select
                        className={`${nativeSelectClass} ml-auto`}
                        value={g.role ?? ''}
                        disabled={busy}
                        onChange={(e) => void act(async () => (await setScimGroupRole({ groupId: g.id, role: (e.target.value || null) as Role | null }), t('ws.scim.roleUpdated', { name: g.displayName })))}
                        aria-label={t('ws.scim.roleFor', { name: g.displayName })}
                      >
                        <option value="">{t('ws.scim.noRole')}</option>
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {t(`ws.roles.${r}` as const)}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.users.length > 0 && (
              <details className="text-sm">
                <summary className="cursor-pointer text-info-text">
                  {t('ws.scim.provisioned', { count: data.users.length, deactivated: data.users.filter((u) => !u.active).length })}
                </summary>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
                  {data.users.map((u) => (
                    <li key={u.id} className="flex gap-2">
                      <span className={u.active ? '' : 'text-muted-foreground line-through'}>{u.email}</span>
                      <span className="text-muted-foreground">
                        {u.active ? t('ws.scim.active') : t('ws.scim.deactivated')} · <span className="font-mono">{when(u.updatedAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
        {message?.text && <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}
