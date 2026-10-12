'use client'

import { useCallback, useEffect, useId, useState } from 'react'
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
import { SAML_PRESETS, SAML_PRESET_INFO, SSO_PRESETS, SSO_PRESET_INFO, type SamlPreset, type SsoPreset } from '@/lib/auth/sso-presets'
import { ROLES, ROLE_INFO, type Role } from '@/lib/auth/permissions'

type Provider = Awaited<ReturnType<typeof listSsoProviders>>[number]

const textareaClass =
  'w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring'

const tagClass = 'rounded-sm border border-border bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground'

function CopyField({ label, value }: { label: string; value: string }) {
  const id = useId()
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-1 text-xs">
      <label htmlFor={id} className="block text-muted-foreground">
        {label}
      </label>
      <div className="flex gap-1">
        <Input id={id} readOnly value={value} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button size="icon" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
          {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
        </Button>
      </div>
    </div>
  )
}

/** Single sign-on (GV-8): workspace admins connect Entra ID, Google Workspace, Okta or any OIDC or SAML 2.0 provider. */
export function SsoSettings() {
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
      setError(err instanceof Error ? err.message : 'Failed to load SSO settings')
    }
  }, [])

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
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(null)
    }
  }

  const info = SSO_PRESET_INFO[form.preset]
  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <SettingsPanel
      title="Single sign-on (SSO)"
      description="People at your email domain sign in with your identity provider and join this workspace automatically. Your provider enforces MFA, so SSO sign-ins skip the Nexus authenticator code."
    >
      <div className="space-y-3">
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus aria-hidden /> Connect a provider
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
                  return "Saved. Enter the Entity ID and ACS URL at your provider, add its metadata here if you haven't, add the TXT record to your DNS, then click Verify domain."
                }
                await createSsoProvider(form)
                setAdding(false)
                setForm({ ...form, clientSecret: '' })
                return 'Saved. Add the redirect URI to your provider and the TXT record to your DNS, then click Verify domain.'
              })
            }}
          >
            <h3 className="text-sm font-semibold">Connect a provider</h3>
            <div className="flex gap-1 rounded-md border border-border p-1 text-sm" role="group" aria-label="Protocol">
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
                <Label htmlFor={`${id}-preset`}>Identity provider</Label>
                {protocol === 'oidc' ? (
                  <select id={`${id}-preset`} className={`${nativeSelectClass} w-full`} value={form.preset} onChange={(e) => setForm({ ...form, preset: e.target.value as SsoPreset, issuerValue: '' })}>
                    {SSO_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {SSO_PRESET_INFO[p].label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select id={`${id}-preset`} className={`${nativeSelectClass} w-full`} value={samlForm.preset} onChange={(e) => setSamlForm({ ...samlForm, preset: e.target.value as SamlPreset })}>
                    {SAML_PRESETS.map((p) => (
                      <option key={p} value={p}>
                        {SAML_PRESET_INFO[p].label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-label`}>Name shown to users</Label>
                <Input id={`${id}-label`} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="KMPlus Microsoft account" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-domain`}>Email domain</Label>
                <Input id={`${id}-domain`} value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="kmplus.co.id" />
              </div>
              {protocol === 'oidc' && info.field && (
                <div className="space-y-1.5">
                  <Label htmlFor={`${id}-issuer`}>{info.field}</Label>
                  <Input id={`${id}-issuer`} value={form.issuerValue} onChange={(e) => setForm({ ...form, issuerValue: e.target.value })} placeholder={info.placeholder} className="font-mono" />
                </div>
              )}
              {protocol === 'oidc' && (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-client`}>Client ID</Label>
                    <Input id={`${id}-client`} value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="font-mono" autoComplete="off" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${id}-secret`}>Client secret</Label>
                    <Input id={`${id}-secret`} type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" />
                  </div>
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-role`}>Role for new SSO users</Label>
                <select id={`${id}-role`} className={`${nativeSelectClass} w-full`} value={form.defaultRole} onChange={(e) => setForm({ ...form, defaultRole: e.target.value as Role })}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_INFO[r].label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {protocol === 'saml' && (
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-metadata`}>IdP metadata: XML or its https URL (optional now; you can add it after creating the app)</Label>
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
            <p className="text-xs text-muted-foreground">{protocol === 'oidc' ? info.help : SAML_PRESET_INFO[samlForm.preset].help}</p>
            <p className="text-xs text-muted-foreground">
              {protocol === 'oidc' ? (
                <>
                  Redirect URI: you get it after saving (<span className="font-mono">{origin}/api/auth/sso/callback/…</span>).
                </>
              ) : (
                <>The Entity ID and ACS URL to enter at your provider appear after saving.</>
              )}{' '}
              Then add the DNS record shown to prove the domain; sign-in stays off until then.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy === 'new'}>
                {busy === 'new' && <Loader2 className="animate-spin" aria-hidden />} Save provider
              </Button>
            </div>
          </form>
        )}

        {notice && <Notice tone="success">{notice}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}

        {!providers ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : providers.length === 0 ? (
          !adding && (
            <EmptyState compact icon={<Fingerprint />} title="No identity provider connected">
              Members sign in with a password and an authenticator app.
            </EmptyState>
          )
        ) : (
          <ul className="space-y-3">
            {providers.map((p) => (
              <li key={p.providerId} className="space-y-3 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-medium">{p.label}</h3>
                  <span className={tagClass}>{p.protocol === 'saml' ? (SAML_PRESET_INFO[p.preset as SamlPreset]?.label ?? 'SAML 2.0') : (SSO_PRESET_INFO[p.preset as SsoPreset]?.label ?? p.preset)}</span>
                  <span className={tagClass}>@{p.domain}</span>
                  <StateMark state={p.verified ? 'live' : 'paused'} className="text-xs">
                    {p.verified ? 'Domain verified' : 'Domain not verified'}
                  </StateMark>
                  {p.enforce && <span className={tagClass}>SSO required</span>}
                </div>
                {p.saml ? (
                  <>
                    <div className="grid gap-2 md:grid-cols-2">
                      <CopyField label="Entity ID / Audience (enter at your identity provider)" value={p.saml.entityId} />
                      <CopyField label="ACS / Reply URL (enter at your identity provider)" value={p.saml.acsUrl} />
                    </div>
                    {p.saml.idpConfigured ? (
                      <p className="text-xs text-muted-foreground">
                        Identity provider: <span className="font-mono">{p.issuer}</span>
                        {p.saml.certificateExpires && <> · signing certificate valid until {new Date(p.saml.certificateExpires).toLocaleDateString()}</>}
                      </p>
                    ) : (
                      <Notice tone="warning" live={false}>
                        Add the identity provider&apos;s metadata to finish the setup.
                      </Notice>
                    )}
                    <SamlMetadataForm
                      configured={p.saml.idpConfigured}
                      onSave={(metadata) =>
                        run(p.providerId, async () => {
                          const r = await setSamlIdp({ providerId: p.providerId, metadata })
                          return `Identity provider saved (${r.entityId}).`
                        })
                      }
                    />
                  </>
                ) : (
                  <div className="grid gap-2 md:grid-cols-2">
                    <CopyField label="Redirect URI (add to your identity provider)" value={p.redirectUri} />
                    <CopyField label="Issuer" value={p.issuer} />
                  </div>
                )}
                {!p.verified && (
                  <div className="space-y-2 rounded-md bg-muted p-2">
                    <p className="text-xs text-muted-foreground">Prove you own {p.domain}: add this TXT record in your DNS, then verify.</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      <CopyField label="TXT record name" value={p.dnsRecord.name} />
                      <CopyField label="TXT record value" value={p.dnsRecord.value} />
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy === p.providerId}
                      onClick={() => void run(p.providerId, async () => (await verifySsoDomain(p.providerId), `${p.domain} verified. People @${p.domain} can now use "Sign in with SSO".`))}
                    >
                      {busy === p.providerId && <Loader2 className="animate-spin" aria-hidden />} Verify domain
                    </Button>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <label className="flex items-center gap-2">
                    New SSO users join as
                    <select
                      className={`${nativeSelectClass} w-40`}
                      value={p.defaultRole}
                      onChange={(e) => void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, defaultRole: e.target.value as Role }), 'Default role updated.'))}
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_INFO[r].label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex items-center gap-2" title={p.verified ? '' : 'Verify the domain first'}>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={p.enforce}
                      disabled={!p.verified}
                      onChange={async (e) => {
                        const enforce = e.target.checked
                        if (enforce) {
                          const ok = await confirm({
                            title: `Require SSO for @${p.domain}?`,
                            description: `Password sign-in is blocked for everyone at @${p.domain}; they must sign in through ${p.label}.`,
                            confirmLabel: 'Require SSO',
                            tone: 'danger',
                          })
                          if (!ok) return
                        }
                        void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, enforce }), enforce ? `Password sign-in is now blocked for @${p.domain}.` : 'Passwords allowed again.'))
                      }}
                    />
                    Require SSO for @{p.domain} (no passwords)
                  </label>
                  <label className="flex items-center gap-2" title="Off: only people your identity provider provisions through SCIM get access">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={p.jitProvisioning}
                      onChange={(e) =>
                        void run(p.providerId, async () => (
                          await updateSsoProvider({ providerId: p.providerId, jitProvisioning: e.target.checked }),
                          e.target.checked ? 'People join on their first sign-in.' : 'Only SCIM-provisioned people get access now.'
                        ))
                      }
                    />
                    Add people on first sign-in
                  </label>
                  <span className="flex-1" />
                  <Button
                    size="sm"
                    variant="destructive"
                    disabled={busy === p.providerId}
                    aria-label={`Disconnect ${p.label}`}
                    onClick={async () => {
                      const ok = await confirm({
                        title: `Disconnect ${p.label}?`,
                        description: 'SSO sign-in stops for this domain. SSO users then need a password reset.',
                        confirmLabel: 'Disconnect',
                        tone: 'danger',
                      })
                      if (ok) void run(p.providerId, async () => (await deleteSsoProvider(p.providerId), 'Provider disconnected.'))
                    }}
                  >
                    Disconnect
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
  const id = useId()
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  if (!open)
    return (
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        Replace client secret
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
          onDone('Client secret replaced.')
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed')
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Label htmlFor={id} className="sr-only">
          New client secret
        </Label>
        <Input id={id} type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="New client secret" className="w-72 max-w-full" autoComplete="new-password" />
        <Button type="submit" size="sm" disabled={!secret}>
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
    </form>
  )
}

function SamlMetadataForm({ configured, onSave }: { configured: boolean; onSave: (metadata: string) => Promise<void> }) {
  const id = useId()
  const [open, setOpen] = useState(!configured)
  const [metadata, setMetadata] = useState('')
  if (!open)
    return (
      <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>
        Replace IdP metadata (new certificate)
      </Button>
    )
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="sr-only">
        IdP metadata
      </Label>
      <textarea id={id} value={metadata} onChange={(e) => setMetadata(e.target.value)} rows={3} className={textareaClass} placeholder="Paste the IdP metadata XML, or its https URL" />
      <div className="flex gap-2">
        <Button size="sm" disabled={!metadata.trim()} onClick={() => void onSave(metadata).then(() => (setMetadata(''), setOpen(false)))}>
          Save metadata
        </Button>
        {configured && (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}
