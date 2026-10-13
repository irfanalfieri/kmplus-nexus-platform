'use client'

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
import { CheckCircle2, Copy, Fingerprint, Loader2, Plus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { createSamlProvider, createSsoProvider, deleteSsoProvider, listSsoProviders, setSamlIdp, updateSsoProvider, verifySsoDomain } from '@/lib/actions/sso'
import { SAML_PRESETS, SSO_PRESETS, SSO_PRESET_INFO, type SamlPreset, type SsoPreset } from '@/lib/auth/sso-presets'
import { ROLES, type Role } from '@/lib/auth/permissions'
import { useT, usePrefs } from '@/components/i18n/i18n-provider'

type Provider = Awaited<ReturnType<typeof listSsoProviders>>[number]

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

const isSsoPreset = (p: string): p is SsoPreset => (SSO_PRESETS as readonly string[]).includes(p)
const isSamlPreset = (p: string): p is SamlPreset => (SAML_PRESETS as readonly string[]).includes(p)

const textareaClass =
  'w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const tagClass = 'rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground'

function CopyField({ label, value }: { label: string; value: string }) {
  const t = useT()
  const id = useId()
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1 text-xs">
      <label htmlFor={id} className="block text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-1">
        <Input id={id} readOnly value={value} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="icon" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={copied ? t('ws.common.copiedLabel', { label }) : t('ws.common.copyLabel', { label })}>
          {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
    </div>
  )
}

/** Single sign-on (GV-8): workspace admins connect Entra ID, Google Workspace, Okta or any OIDC or SAML 2.0 provider. */
export function SsoSettings() {
  const { t, formatDateTime } = usePrefs()
  const id = useId()
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', preset: 'azure' as SsoPreset, issuerValue: '', domain: '', clientId: '', clientSecret: '', defaultRole: 'viewer' as Role })
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc')
  const [samlForm, setSamlForm] = useState({ preset: 'azure' as SamlPreset, metadata: '' })
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback(async () => {
    try {
      setProviders(await listSsoProviders())
    } catch (err) {
      setError(err instanceof Error ? err.message : t('ws.sso.loadFailed'))
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

  const info = SSO_PRESET_INFO[form.preset]
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <SettingsPanel
      title={t('ws.sso.title')}
      description={t('ws.sso.description')}
    >
      <div className="space-y-3">
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> {t('ws.sso.connect')}
          </Button>
        )}

        {adding && (
          <form
            className="space-y-3 rounded-md border border-border p-3"
            onSubmit={(e) => {
              e.preventDefault()
              void run('new', async () => {
                if (protocol === 'saml') {
                  await createSamlProvider({ label: form.label, preset: samlForm.preset, domain: form.domain, defaultRole: form.defaultRole, metadata: samlForm.metadata || undefined })
                  setAdding(false)
                  setSamlForm({ ...samlForm, metadata: '' })
                  return t('ws.sso.savedSaml')
                }
                await createSsoProvider(form)
                setAdding(false)
                setForm({ ...form, clientSecret: '' })
                return t('ws.sso.savedOidc')
              })
            }}
          >
            <h3 className="text-sm font-semibold">{t('ws.sso.connect')}</h3>
            <div className="flex gap-1 rounded-md border border-border p-1 text-sm" role="group" aria-label={t('ws.sso.protocol')}>
              {(['oidc', 'saml'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={protocol === p}
                  onClick={() => setProtocol(p)}
                  className={cn(
                    'flex-1 rounded-sm px-2 py-1 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                    protocol === p ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )}
                >
                  {p === 'oidc' ? 'OpenID Connect' : 'SAML 2.0'}
                </button>
              ))}
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-preset`}>{t('ws.sso.idp')}</Label>
                {protocol === 'oidc' ? (
                  <select id={`${id}-preset`} className={`${nativeSelectClass} w-full`} value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value as SsoPreset, issuerValue: '' })}>
                    {SSO_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {t(`ws.sso.presets.${p}.label` as const)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select id={`${id}-preset`} className={`${nativeSelectClass} w-full`} value={samlForm.preset} onChange={(e) => setSamlForm({ ...samlForm, preset: e.target.value as SamlPreset })}>
                    {SAML_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {t(`ws.sso.samlPresets.${p}.label` as const)}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-label`}>{t('ws.sso.label')}</Label>
                <Input id={`${id}-label`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder={t('ws.sso.labelPlaceholder')} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-domain`}>{t('ws.sso.domain')}</Label>
                <Input id={`${id}-domain`} value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="kmplus.co.id" />
              </div>
              {protocol === 'oidc' && info.field && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-issuer`}>{t(`ws.sso.presets.${form.preset}.field` as const)}</Label>
                  <Input id={`${id}-issuer`} value={form.issuerValue} onChange={(e) => setForm({ ...form, issuerValue: e.target.value })} placeholder={info.placeholder} className="font-mono" />
                </div>
              )}
              {protocol === 'oidc' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-client`}>{t('ws.sso.clientId')}</Label>
                    <Input id={`${id}-client`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="font-mono" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-secret`}>{t('ws.sso.clientSecret')}</Label>
                    <Input id={`${id}-secret`} type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-role`}>{t('ws.sso.defaultRole')}</Label>
                <select id={`${id}-role`} className={`${nativeSelectClass} w-full`} value={form.defaultRole} onChange={(e) => setForm({ ...form, defaultRole: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {t(`ws.roles.${r}` as const)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {protocol === 'saml' && (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-metadata`}>{t('ws.sso.metadata')}</Label>
                <textarea
                  id={`${id}-metadata`}
                  value={samlForm.metadata}
                  onChange={(e) => setSamlForm({ ...samlForm, metadata: e.target.value })}
                  rows={3}
                  className={textareaClass}
                  placeholder="https://login.microsoftonline.com/<tenant>/federationmetadata/2007-06/federationmetadata.xml?appid=…"
                />
              </div>
            )}
            <p className="text-xs text-muted-foreground">{protocol === 'oidc' ? t(`ws.sso.presets.${form.preset}.help` as const) : t(`ws.sso.samlPresets.${samlForm.preset}.help` as const)}</p>
            <p className="text-xs text-muted-foreground">
              {protocol === 'oidc' ? rich(t('ws.sso.redirectLater'), { url: <span className="font-mono">{origin}/api/auth/sso/callback/…</span> }) : t('ws.sso.samlLater')}{' '}
              {t('ws.sso.dnsAfter')}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" size="sm" disabled={busy === 'new'}>
                {busy === 'new' && <Loader2 className="animate-spin" aria-hidden />} {t('ws.sso.save')}
              </Button>
            </div>
          </form>
        )}

        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {!providers ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : providers.length === 0 ? (
          !adding && (
            <EmptyState compact icon={<Fingerprint />} title={t('ws.sso.emptyTitle')}>
              {t('ws.sso.emptyBody')}
            </EmptyState>
          )
        ) : (
          <ul className="space-y-3">
            {providers.map((p) => (
              <li key={p.providerId} className="space-y-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{p.label}</h3>
                  <span className={tagClass}>{p.protocol === 'saml'
                      ? isSamlPreset(p.preset)
                        ? t(`ws.sso.samlPresets.${p.preset}.label` as const)
                        : 'SAML 2.0'
                      : isSsoPreset(p.preset)
                        ? t(`ws.sso.presets.${p.preset}.label` as const)
                        : p.preset}</span>
                  <span className={tagClass}>@{p.domain}</span>
                  <StateMark state={p.verified ? 'live' : 'paused'} className="text-xs">
                    {p.verified ? t('ws.sso.verified') : t('ws.sso.notVerified')}
                  </StateMark>
                  {p.enforce && <span className={tagClass}>{t('ws.sso.required')}</span>}
                </div>
                {p.saml ? (
                  <>
                    <div className="grid gap-2 md:grid-cols-2">
                      <CopyField label={t('ws.sso.entityId')} value={p.saml.entityId} />
                      <CopyField label={t('ws.sso.acsUrl')} value={p.saml.acsUrl} />
                    </div>
                    {p.saml.idpConfigured ? (
                      <p className="text-xs text-muted-foreground">
                        {rich(t('ws.sso.idpIs'), { issuer: <span className="font-mono">{p.issuer}</span> })}
                        {p.saml.certificateExpires && <> · {t('ws.sso.certValid', { date: formatDateTime(p.saml.certificateExpires, { dateStyle: 'medium', timeStyle: undefined }) })}</>}
                      </p>
                    ) : (
                      <Notice tone="warning" live={false}>
                        {t('ws.sso.addMetadata')}
                      </Notice>
                    )}
                    <SamlMetadataForm
                      configured={p.saml.idpConfigured}
                      onSave={(metadata) =>
                        run(p.providerId, async () => {
                          const r = await setSamlIdp({ providerId: p.providerId, metadata })
                          return t('ws.sso.idpSaved', { entityId: r.entityId })
                        })
                      }
                    />
                  </>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <CopyField label={t('ws.sso.redirectUri')} value={p.redirectUri} />
                    <CopyField label={t('ws.sso.issuer')} value={p.issuer} />
                  </div>
                )}
                {!p.verified && (
                  <div className="space-y-2 rounded-md bg-muted p-2">
                    <p className="text-xs text-muted-foreground">{t('ws.sso.prove', { domain: p.domain })}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <CopyField label={t('ws.sso.txtName')} value={p.dnsRecord.name} />
                      <CopyField label={t('ws.sso.txtValue')} value={p.dnsRecord.value} />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === p.providerId}
                      onClick={() => void run(p.providerId, async () => (await verifySsoDomain(p.providerId), t('ws.sso.verifiedDone', { domain: p.domain })))}
                    >
                      {busy === p.providerId && <Loader2 className="animate-spin" aria-hidden />} {t('ws.sso.verify')}
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    {t('ws.sso.joinAs')}
                    <select
                      className={`${nativeSelectClass} w-40`}
                      value={p.defaultRole}
                      onChange={(e) => void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, defaultRole: e.target.value as Role }), t('ws.sso.roleUpdated')))}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`ws.roles.${r}` as const)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2" title={p.verified ? '' : t('ws.sso.verifyFirst')}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={p.enforce}
                      disabled={!p.verified}
                      onChange={async (e) => {
                        const enforce = e.target.checked
                        if (enforce) {
                          const ok = await confirm({
                            title: t('ws.sso.requireTitle', { domain: p.domain }),
                            description: t('ws.sso.requireBody', { domain: p.domain, provider: p.label }),
                            confirmLabel: t('ws.sso.requireConfirm'),
                            tone: 'danger',
                          })
                          if (!ok) return
                        }
                        void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, enforce }), enforce ? t('ws.sso.blocked', { domain: p.domain }) : t('ws.sso.allowed')))
                      }}
                    />
                    {t('ws.sso.require', { domain: p.domain })}
                  </label>
                  <label className="flex items-center gap-2" title={t('ws.sso.jitTitle')}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={p.jitProvisioning}
                      onChange={(e) =>
                        void run(p.providerId, async () => (
                          await updateSsoProvider({ providerId: p.providerId, jitProvisioning: e.target.checked }),
                          e.target.checked ? t('ws.sso.jitOn') : t('ws.sso.jitOff')
                        ))
                      }
                    />
                    {t('ws.sso.jit')}
                  </label>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === p.providerId}
                    aria-label={t('ws.sso.disconnectLabel', { name: p.label })}
                    onClick={async () => {
                      const ok = await confirm({
                        title: t('ws.sso.disconnectTitle', { name: p.label }),
                        description: t('ws.sso.disconnectBody'),
                        confirmLabel: t('ws.sso.disconnect'),
                        tone: 'danger',
                      })
                      if (ok) void run(p.providerId, async () => (await deleteSsoProvider(p.providerId), t('ws.sso.disconnected')))
                    }}
                  >
                    {t('ws.sso.disconnect')}
                  </Button>
                </div>
                {p.protocol === 'oidc' && <RotateSecret providerId={p.providerId} onDone={(msg) => void run(p.providerId, async () => msg)} />}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}

function RotateSecret({ providerId, onDone }: { providerId: string; onDone: (msg: string) => void }) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  if (!open)
    return (
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        {t('ws.sso.replaceSecret')}
      </Button>
    )
  return (
    <form
      className="space-y-2"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!secret) return
        try {
          await updateSsoProvider({ providerId, clientSecret: secret })
          setSecret('')
          setOpen(false)
          onDone(t('ws.sso.secretReplaced'))
        } catch (err) {
          setError(err instanceof Error ? err.message : t('ws.common.failed'))
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="sr-only">
          {t('ws.sso.newSecret')}
        </Label>
        <Input id={id} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={t('ws.sso.newSecret')} className="w-72 max-w-full" autoComplete="new-password" />
        <Button type="submit" size="sm" disabled={!secret}>
          {t('common.save')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  )
}

function SamlMetadataForm({ configured, onSave }: { configured: boolean; onSave: (metadata: string) => Promise<void> }) {
  const t = useT()
  const id = useId()
  const [open, setOpen] = useState(!configured)
  const [metadata, setMetadata] = useState('')
  if (!open)
    return (
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        {t('ws.sso.replaceMetadata')}
      </Button>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        {t('ws.sso.metadataLabel')}
      </Label>
      <textarea id={id} value={metadata} onChange={(e) => setMetadata(e.target.value)} rows={3} className={textareaClass} placeholder={t('ws.sso.metadataPlaceholder')} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!metadata.trim()} onClick={() => void onSave(metadata).then(() => (setMetadata(''), setOpen(false)))}>
          {t('ws.sso.saveMetadata')}
        </Button>
        {configured && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  )
}
