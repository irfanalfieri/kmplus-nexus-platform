'use client'

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
import { Check, Copy, KeySquare, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/actions/api-keys'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { isRole } from '@/lib/auth/permissions'

type Key = Awaited<ReturnType<typeof listApiKeys>>[number]

/** Short date and time in WIB, in the interface language. */
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }
const DAY: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', year: 'numeric' }

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

/** Data API keys (API-1): admins create scoped keys (shown once) and revoke them. */
export function ApiKeys() {
  const { t, formatDateTime } = usePrefs()
  const roleLabel = (r: string) => (isRole(r) ? t(`ws.roles.${r}` as const) : r)
  const id = useId()
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'analyst' | 'steward'>('analyst')
  const [scopes, setScopes] = useState<string[]>(['datasets:read', 'domains:read'])
  const [expires, setExpires] = useState('365')
  const [rate, setRate] = useState('120')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback(async () => {
    try {
      setKeys(await listApiKeys())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.apiKeys.loadFailed'))
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await createApiKey({
        name,
        role,
        scopes: scopes as ('datasets:read' | 'domains:read' | 'pipelines:run' | 'runs:read')[],
        expiresInDays: expires ? Number(expires) : null,
        rateLimitPerMinute: Number(rate),
      })
      setCreated(res.key)
      setCopied(false)
      setCreating(false)
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.apiKeys.createFailed'))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (k: Key) => {
    const ok = await confirm({
      title: t('ws.apiKeys.revokeTitle', { name: k.name }),
      description: t('ws.apiKeys.revokeBody'),
      confirmLabel: t('ws.apiKeys.revokeConfirm'),
      tone: 'danger',
    })
    if (!ok) return
    try {
      await revokeApiKey(k.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.apiKeys.revokeFailed'))
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <SettingsPanel
      title={t('ws.apiKeys.title')}
      description={rich(t('ws.apiKeys.description'), {
        examples: (
          <>
            <span className="font-mono text-xs">GET {origin}/api/v1/datasets/&lt;name&gt;</span>, <span className="font-mono text-xs">/api/v1/domains/employee</span>,{' '}
            <span className="font-mono text-xs">POST /api/v1/pipelines/&lt;id&gt;/runs</span>
          </>
        ),
        spec: (
          <a className="text-info-text underline-offset-4 hover:underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            {t('ws.apiKeys.spec')}
          </a>
        ),
      })}
    >
      <div className="space-y-3">
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> {t('ws.apiKeys.newKey')}
          </Button>
        )}

        {created && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm" role="status">
            <h3 className="font-semibold">{t('ws.apiKeys.copyNow')}</h3>
            <div className="flex gap-2">
              <Input readOnly value={created} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('ws.apiKeys.keyLabel')} />
              <Button
                size="icon"
                variant="outline"
                aria-label={copied ? t('ws.apiKeys.keyCopied') : t('ws.apiKeys.copyKey')}
                onClick={() => {
                  void navigator.clipboard.writeText(created).then(() => setCopied(true))
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <Button variant="ghost" onClick={() => setCreated(null)}>
                {t('ws.common.done')}
              </Button>
            </div>
            <div className="font-mono text-xs text-muted-foreground">
              curl -H &quot;Authorization: Bearer {created.slice(0, 12)}…&quot; {origin}/api/v1/datasets
            </div>
          </div>
        )}

        {creating && (
          <form
            className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault()
              void create()
            }}
          >
            <h3 className="text-sm font-semibold md:col-span-4">{t('ws.apiKeys.formTitle')}</h3>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor={`${id}-name`}>{t('ws.apiKeys.name')}</Label>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ws.apiKeys.namePlaceholder')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-role`}>{t('ws.apiKeys.readsAs')}</Label>
              <select id={`${id}-role`} className={`${nativeSelectClass} w-full`} value={role} onChange={(e) => setRole(e.target.value as 'analyst' | 'steward')}>
                <option value="analyst">{t('ws.apiKeys.roleAnalyst')}</option>
                <option value="steward">{t('ws.apiKeys.roleSteward')}</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-expires`}>{t('ws.apiKeys.expires')}</Label>
              <select id={`${id}-expires`} className={`${nativeSelectClass} w-full`} value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="30">{t('ws.apiKeys.in30')}</option>
                <option value="90">{t('ws.apiKeys.in90')}</option>
                <option value="365">{t('ws.apiKeys.in365')}</option>
                <option value="">{t('ws.apiKeys.never')}</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-4">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`${id}-rate`}>{t('ws.apiKeys.limit')}</Label>
                <select id={`${id}-rate`} className={`${nativeSelectClass} w-36`} value={rate} onChange={(e) => setRate(e.target.value)} aria-label={t('ws.apiKeys.perMinuteLabel')}>
                  {['60', '120', '300', '600', '1200'].map((r) => (
                    <option key={r} value={r}>
                      {t('ws.apiKeys.perMinute', { count: r })}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">{t('ws.apiKeys.scopes')}</legend>
                {[
                  ['datasets:read', t('ws.apiKeys.scopeDatasets')],
                  ['domains:read', t('ws.apiKeys.scopeDomains')],
                  ['pipelines:run', t('ws.apiKeys.scopeRun')],
                  ['runs:read', t('ws.apiKeys.scopeRuns')],
                ].map(([s, label]) => (
                  <label key={s} className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={scopes.includes(s)}
                      onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <span className="flex-1" />
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreating(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim() || !scopes.length}>
                {busy && <Loader2 className="animate-spin" aria-hidden />} {t('ws.apiKeys.create')}
              </Button>
            </div>
          </form>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        {!keys ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : keys.length === 0 ? (
          <EmptyState compact icon={<KeySquare />} title={t('ws.apiKeys.emptyTitle')}>
            {t('ws.apiKeys.emptyBody')}
          </EmptyState>
        ) : (
          <div className="-mx-5 border-y border-border">
            <Table label={t('ws.apiKeys.title')} className="min-w-[720px]">
              <THead>
                <tr>
                  <Th className="pl-5">{t('ws.apiKeys.colKey')}</Th>
                  <Th>{t('ws.apiKeys.colAccess')}</Th>
                  <Th>{t('ws.apiKeys.colStatus')}</Th>
                  <Th>{t('ws.apiKeys.colUsage')}</Th>
                  <Th className="pr-5">
                    <span className="sr-only">{t('ws.apiKeys.colActions')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {keys.map((k) => {
                  const expired = !!k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()
                  return (
                    <Tr key={k.id} className={k.revokedAt || expired ? 'text-muted-foreground' : undefined}>
                      <Td className="pl-5">
                        <div className="font-medium">{k.name}</div>
                        <div className="font-mono text-xs text-muted-foreground">{k.prefix}…</div>
                      </Td>
                      <Td>
                        <div className="text-sm">
                          {roleLabel(k.role)} · <span className="font-mono">{t('ws.apiKeys.rate', { count: k.rateLimitPerMinute })}</span>
                        </div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {k.scopes.map((s) => (
                            <span key={s} className="rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                              {s}
                            </span>
                          ))}
                        </div>
                      </Td>
                      <Td>
                        <StateMark state={k.revokedAt ? 'tripped' : expired ? 'paused' : 'live'} className="text-xs">
                          {k.revokedAt ? t('ws.common.revoked') : expired ? t('ws.apiKeys.expired') : t('ws.common.active')}
                        </StateMark>
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        <div>{t('ws.apiKeys.by', { email: k.createdByEmail ?? t('ws.apiKeys.unknown') })}</div>
                        <div className="font-mono">
                          {t('ws.common.lastUsed', { when: k.lastUsedAt ? `${formatDateTime(k.lastUsedAt, WHEN)} WIB` : t('ws.common.never') })}
                          {k.expiresAt ? ` · ${t('ws.apiKeys.expiresOn', { date: formatDateTime(k.expiresAt, DAY) })}` : ` · ${t('ws.apiKeys.neverExpires')}`}
                        </div>
                      </Td>
                      <Td className="pr-5 text-right">
                        {!k.revokedAt && (
                          <Button size="sm" variant="destructive" aria-label={t('ws.apiKeys.revokeLabel', { name: k.name })} onClick={() => void revoke(k)}>
                            {t('ws.common.revoke')}
                          </Button>
                        )}
                      </Td>
                    </Tr>
                  )
                })}
              </TBody>
            </Table>
          </div>
        )}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}
