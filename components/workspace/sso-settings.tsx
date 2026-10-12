'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Fingerprint, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { createSamlProvider, createSsoProvider, deleteSsoProvider, listSsoProviders, setSamlIdp, updateSsoProvider, verifySsoDomain } from '@/lib/actions/sso'
import { SAML_PRESETS, SAML_PRESET_INFO, SSO_PRESETS, SSO_PRESET_INFO, type SamlPreset, type SsoPreset } from '@/lib/auth/sso-presets'
import { ROLES, ROLE_INFO, type Role } from '@/lib/auth/permissions'
import { NativeSelect } from '@/components/pipelines/step-editors'

type Provider = Awaited<ReturnType<typeof listSsoProviders>>[number]

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="text-xs">
      <div className="mb-0.5 text-muted-foreground">{label}</div>
      <div className="flex gap-1">
        <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
        <Button size="sm" variant="outline" className="h-8" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={`Copy ${label}`}>
          {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  )
}

/** Single sign-on (GV-8): workspace admins connect Entra ID, Google Workspace, Okta or any OIDC or SAML 2.0 provider. */
export function SsoSettings() {
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [form, setForm] = useState({ label: '', preset: 'azure' as SsoPreset, issuerValue: '', domain: '', clientId: '', clientSecret: '', defaultRole: 'viewer' as Role })
  const [protocol, setProtocol] = useState<'oidc' | 'saml'>('oidc')
  const [samlForm, setSamlForm] = useState({ preset: 'azure' as SamlPreset, metadata: '' })
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

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

  const run = async (id: string, fn: () => Promise<string | void>) => {
    setBusy(id)
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
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Single sign-on">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <Fingerprint className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <h3 className="font-semibold">Single sign-on (SSO)</h3>
          <p className="text-sm text-muted-foreground">
            People at your email domain sign in with your identity provider and join this workspace automatically. Your provider enforces MFA, so SSO sign-ins skip the Nexus authenticator code.
          </p>
        </div>
        {!adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Connect a provider
          </Button>
        )}
      </div>

      {adding && (
        <div className="mb-4 space-y-3 rounded-md border border-border p-3">
          <div className="flex gap-1 rounded-md border border-border p-1 text-sm" role="tablist" aria-label="Protocol">
            {(['oidc', 'saml'] as const).map((p) => (
              <button key={p} role="tab" aria-selected={protocol === p} onClick={() => setProtocol(p)} className={`flex-1 rounded px-2 py-1 ${protocol === p ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>
                {p === 'oidc' ? 'OpenID Connect' : 'SAML 2.0'}
              </button>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Identity provider</span>
              {protocol === 'oidc' ? (
                <NativeSelect value={form.preset} onChange={(v) => setForm({ ...form, preset: v as SsoPreset, issuerValue: '' })}>
                  {SSO_PRESETS.map((p) => (
                    <option key={p} value={p}>{SSO_PRESET_INFO[p].label}</option>
                  ))}
                </NativeSelect>
              ) : (
                <NativeSelect value={samlForm.preset} onChange={(v) => setSamlForm({ ...samlForm, preset: v as SamlPreset })}>
                  {SAML_PRESETS.map((p) => (
                    <option key={p} value={p}>{SAML_PRESET_INFO[p].label}</option>
                  ))}
                </NativeSelect>
              )}
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Name shown to users</span>
              <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="KMPlus Microsoft account" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Email domain</span>
              <Input value={form.domain} onChange={(e) => setForm({ ...form, domain: e.target.value })} placeholder="kmplus.co.id" />
            </label>
            {protocol === 'oidc' && info.field && (
              <label className="text-sm">
                <span className="mb-1 block text-xs text-muted-foreground">{info.field}</span>
                <Input value={form.issuerValue} onChange={(e) => setForm({ ...form, issuerValue: e.target.value })} placeholder={info.placeholder} className="font-mono" />
              </label>
            )}
            {protocol === 'oidc' && (
              <>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Client ID</span>
              <Input value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className="font-mono" autoComplete="off" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Client secret</span>
              <Input type="password" value={form.clientSecret} onChange={(e) => setForm({ ...form, clientSecret: e.target.value })} autoComplete="new-password" />
            </label>
              </>
            )}
            <label className="text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">Role for new SSO users</span>
              <NativeSelect value={form.defaultRole} onChange={(v) => setForm({ ...form, defaultRole: v as Role })}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_INFO[r].label}</option>
                ))}
              </NativeSelect>
            </label>
          </div>
          {protocol === 'saml' && (
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted-foreground">IdP metadata: XML or its https URL (optional now; you can add it after creating the app)</span>
              <textarea value={samlForm.metadata} onChange={(e) => setSamlForm({ ...samlForm, metadata: e.target.value })} rows={3} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" placeholder="https://login.microsoftonline.com/<tenant>/federationmetadata/2007-06/federationmetadata.xml?appid=…" aria-label="IdP metadata" />
            </label>
          )}
          <p className="text-xs text-muted-foreground">{protocol === 'oidc' ? info.help : SAML_PRESET_INFO[samlForm.preset].help}</p>
          <p className="text-xs text-muted-foreground">
            {protocol === 'oidc' ? (
              <>Redirect URI: you get it after saving (<span className="font-mono">{origin}/api/auth/sso/callback/…</span>).</>
            ) : (
              <>The Entity ID and ACS URL to enter at your provider appear after saving.</>
            )}{' '}
            Then add the DNS record shown to prove the domain; sign-in stays off until then.
          </p>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button
              size="sm"
              disabled={busy === 'new'}
              onClick={() =>
                void run('new', async () => {
                  if (protocol === 'saml') {
                    await createSamlProvider({ label: form.label, preset: samlForm.preset, domain: form.domain, defaultRole: form.defaultRole, metadata: samlForm.metadata || undefined })
                    setAdding(false)
                    setSamlForm({ ...samlForm, metadata: '' })
                    return 'Saved. Enter the Entity ID and ACS URL at your provider, add its metadata here if you haven\'t, add the TXT record to your DNS, then click Verify domain.'
                  }
                  await createSsoProvider(form)
                  setAdding(false)
                  setForm({ ...form, clientSecret: '' })
                  return 'Saved. Add the redirect URI to your provider and the TXT record to your DNS, then click Verify domain.'
                })
              }
            >
              {busy === 'new' && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Save provider
            </Button>
          </div>
        </div>
      )}

      {notice && <p className="mb-3 rounded-md bg-green-500/10 p-2 text-sm text-green-700 dark:text-green-400" role="status">{notice}</p>}
      {error && <p className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">{error}</p>}

      {!providers ? (
        <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</p>
      ) : providers.length === 0 ? (
        !adding && <p className="text-sm text-muted-foreground">No identity provider connected. Members sign in with a password and an authenticator app.</p>
      ) : (
        <ul className="space-y-3">
          {providers.map((p) => (
            <li key={p.providerId} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{p.label}</span>
                <Badge variant="outline">{p.protocol === 'saml' ? (SAML_PRESET_INFO[p.preset as SamlPreset]?.label ?? 'SAML 2.0') : (SSO_PRESET_INFO[p.preset as SsoPreset]?.label ?? p.preset)}</Badge>
                <Badge variant="outline">@{p.domain}</Badge>
                {p.verified ? <Badge className="bg-green-600 text-white hover:bg-green-600">domain verified</Badge> : <Badge variant="destructive">domain not verified</Badge>}
                {p.enforce && <Badge variant="secondary">SSO required</Badge>}
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
                    <p className="text-xs text-amber-700 dark:text-amber-300">Add the identity provider&apos;s metadata to finish the setup.</p>
                  )}
                  <SamlMetadataForm configured={p.saml.idpConfigured} onSave={(metadata) => run(p.providerId, async () => { const r = await setSamlIdp({ providerId: p.providerId, metadata }); return `Identity provider saved (${r.entityId}).` })} />
                </>
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  <CopyField label="Redirect URI (add to your identity provider)" value={p.redirectUri} />
                  <CopyField label="Issuer" value={p.issuer} />
                </div>
              )}
              {!p.verified && (
                <div className="space-y-2 rounded-md bg-muted/40 p-2">
                  <p className="text-xs text-muted-foreground">Prove you own {p.domain}: add this TXT record in your DNS, then verify.</p>
                  <div className="grid gap-2 md:grid-cols-2">
                    <CopyField label="TXT record name" value={p.dnsRecord.name} />
                    <CopyField label="TXT record value" value={p.dnsRecord.value} />
                  </div>
                  <Button size="sm" variant="outline" disabled={busy === p.providerId} onClick={() => void run(p.providerId, async () => (await verifySsoDomain(p.providerId), `${p.domain} verified. People @${p.domain} can now use "Sign in with SSO".`))}>
                    {busy === p.providerId && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Verify domain
                  </Button>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  New SSO users join as
                  <NativeSelect className="w-40" value={p.defaultRole} onChange={(v) => void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, defaultRole: v as Role }), 'Default role updated.'))}>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_INFO[r].label}</option>
                    ))}
                  </NativeSelect>
                </label>
                <label className="flex items-center gap-2" title={p.verified ? '' : 'Verify the domain first'}>
                  <input
                    type="checkbox"
                    checked={p.enforce}
                    disabled={!p.verified}
                    onChange={(e) => void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, enforce: e.target.checked }), e.target.checked ? `Password sign-in is now blocked for @${p.domain}.` : 'Passwords allowed again.'))}
                  />
                  Require SSO for @{p.domain} (no passwords)
                </label>
                <label className="flex items-center gap-2" title="Off: only people your identity provider provisions through SCIM get access">
                  <input type="checkbox" checked={p.jitProvisioning} onChange={(e) => void run(p.providerId, async () => (await updateSsoProvider({ providerId: p.providerId, jitProvisioning: e.target.checked }), e.target.checked ? 'People join on their first sign-in.' : 'Only SCIM-provisioned people get access now.'))} />
                  Add people on first sign-in
                </label>
                <span className="flex-1" />
                {confirmDelete === p.providerId ? (
                  <span className="flex items-center gap-1 text-xs">
                    Disconnect? SSO users then need a password reset.
                    <Button size="sm" variant="destructive" onClick={() => void run(p.providerId, async () => (await deleteSsoProvider(p.providerId), 'Provider disconnected.'))}>Disconnect</Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>Cancel</Button>
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(p.providerId)}>Disconnect</Button>
                )}
              </div>
              {p.protocol === 'oidc' && <RotateSecret providerId={p.providerId} onDone={(msg) => void run(p.providerId, async () => msg)} />}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function RotateSecret({ providerId, onDone }: { providerId: string; onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false)
  const [secret, setSecret] = useState('')
  const [error, setError] = useState('')
  if (!open) return <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>Replace client secret</Button>
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="New client secret" className="h-8 w-72" autoComplete="new-password" aria-label="New client secret" />
      <Button
        size="sm"
        onClick={async () => {
          try {
            await updateSsoProvider({ providerId, clientSecret: secret })
            setSecret('')
            setOpen(false)
            onDone('Client secret replaced.')
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed')
          }
        }}
        disabled={!secret}
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

function SamlMetadataForm({ configured, onSave }: { configured: boolean; onSave: (metadata: string) => Promise<void> }) {
  const [open, setOpen] = useState(!configured)
  const [metadata, setMetadata] = useState('')
  if (!open) return <Button size="sm" variant="ghost" className="text-xs" onClick={() => setOpen(true)}>Replace IdP metadata (new certificate)</Button>
  return (
    <div className="space-y-2">
      <textarea value={metadata} onChange={(e) => setMetadata(e.target.value)} rows={3} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" placeholder="Paste the IdP metadata XML, or its https URL" aria-label="IdP metadata" />
      <div className="flex gap-2">
        <Button size="sm" disabled={!metadata.trim()} onClick={() => void onSave(metadata).then(() => (setMetadata(''), setOpen(false)))}>
          Save metadata
        </Button>
        {configured && <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
      </div>
    </div>
  )
}
