'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Loader2, Plus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { createScimToken, getScimOverview, revokeScimToken, setScimGroupRole } from '@/lib/actions/scim'
import { ROLES, ROLE_INFO, type Role } from '@/lib/auth/permissions'
import { formatWhen } from '@/components/pipelines/run-history'

type Overview = Awaited<ReturnType<typeof getScimOverview>>

const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-xs'

function Copyable({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-1">
      <Input readOnly value={value} className="h-8 font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={label} />
      <Button size="sm" variant="outline" className="h-8" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={`Copy ${label}`}>
        {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}

/**
 * SCIM provisioning (GV-8): the identity provider adds, updates and removes
 * members automatically; IdP groups can carry Nexus roles.
 */
export function ScimSettings() {
  const [data, setData] = useState<Overview | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await getScimOverview())
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not load SCIM settings' })
    }
  }, [])

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
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(false)
    }
  }

  const active = data?.tokens.filter((t) => !t.revokedAt) ?? []

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label="SCIM provisioning">
      <div className="flex items-start gap-3">
        <Users className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">SCIM provisioning</h3>
          <p className="text-sm text-muted-foreground">
            Let Entra ID or Okta add people when HR onboards them and remove their access the moment they are deactivated. People must be at a verified SSO domain of this workspace and sign in with SSO. Turn off &ldquo;Add people on first sign-in&rdquo; under SSO to allow only provisioned people.
          </p>
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : (
        <>
          <div className="grid gap-2 md:grid-cols-2">
            <div className="text-xs">
              <div className="mb-0.5 text-muted-foreground">Tenant URL / SCIM connector base URL</div>
              <Copyable value={data.baseUrl} label="SCIM base URL" />
            </div>
          </div>

          {created && (
            <div className="space-y-1 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
              <p className="font-medium">Copy the token now: it is shown only once. Paste it as the Secret Token / API token at your identity provider.</p>
              <Copyable value={created} label="SCIM token" />
              <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                Done
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Input className="h-9 max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Entra ID provisioning" aria-label="Token name" />
            <Button size="sm" disabled={busy || !name.trim()} onClick={() => void act(async () => (setCreated((await createScimToken(name)).token), setName(''), ''))}>
              <Plus className="mr-1 h-4 w-4" /> Create token
            </Button>
          </div>
          {data.tokens.length > 0 && (
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {data.tokens.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 p-2">
                  <span className="font-medium">{t.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span>
                  <span className="text-xs text-muted-foreground">
                    {t.revokedAt ? `revoked ${formatWhen(t.revokedAt)}` : `last used ${t.lastUsedAt ? formatWhen(t.lastUsedAt) : 'never'}`}
                  </span>
                  {!t.revokedAt && (
                    <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void act(async () => (await revokeScimToken(t.id), 'Token revoked: provisioning with it stops now.'))}>
                      Revoke
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!active.length && <p className="text-xs text-muted-foreground">No active token: provisioning is off.</p>}

          {data.groups.length > 0 && (
            <div>
              <h4 className="mb-1 text-sm font-medium">Groups from your identity provider</h4>
              <p className="mb-2 text-xs text-muted-foreground">Give a group a role and its members get it (the highest of their groups). Groups without a role leave roles alone.</p>
              <ul className="divide-y divide-border rounded-md border border-border text-sm">
                {data.groups.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-2 p-2">
                    <span className="font-medium">{g.displayName}</span>
                    <span className="text-xs text-muted-foreground">{g.members} member{g.members === 1 ? '' : 's'}</span>
                    <select
                      className={`${selectClass} ml-auto`}
                      value={g.role ?? ''}
                      disabled={busy}
                      onChange={(e) => void act(async () => (await setScimGroupRole({ groupId: g.id, role: (e.target.value || null) as Role | null }), `${g.displayName}: role updated.`))}
                      aria-label={`Role for ${g.displayName}`}
                    >
                      <option value="">No role</option>
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {ROLE_INFO[r].label}
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
              <summary className="cursor-pointer text-primary">
                {data.users.length} provisioned {data.users.length === 1 ? 'person' : 'people'} ({data.users.filter((u) => !u.active).length} deactivated)
              </summary>
              <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
                {data.users.map((u) => (
                  <li key={u.id} className="flex gap-2">
                    <span className={u.active ? '' : 'text-muted-foreground line-through'}>{u.email}</span>
                    <span className="text-muted-foreground">{u.active ? 'active' : 'deactivated'} · {formatWhen(u.updatedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
      {message?.text && <p className={`rounded-md p-2 text-sm ${message.kind === 'ok' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>{message.text}</p>}
    </section>
  )
}
