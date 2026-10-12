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
import { ROLES, ROLE_INFO, type Role } from '@/lib/auth/permissions'
import { formatWhen } from '@/components/pipelines/run-history'

type Overview = Awaited<ReturnType<typeof getScimOverview>>

function Copyable({ value, label, id }: { value: string; label: string; id?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex gap-1">
      <Input id={id} readOnly value={value} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={id ? undefined : label} />
      <Button size="icon" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={copied ? `${label} copied` : `Copy ${label}`}>
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
    <SettingsPanel
      title="SCIM provisioning"
      description={
        <>
          Let Entra ID or Okta add people when HR onboards them and remove their access the moment they are deactivated. People must be at a verified SSO domain of this workspace and sign in with SSO. Turn off &ldquo;Add people on first sign-in&rdquo; under SSO to allow only provisioned people.
        </>
      }
    >
      <div className="space-y-4">
        {!data ? (
          message?.kind === 'err' ? null : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
            </p>
          )
        ) : (
          <>
            <div className="max-w-xl space-y-1.5">
              <Label htmlFor={`${id}-base`}>Tenant URL / SCIM connector base URL</Label>
              <Copyable id={`${id}-base`} value={data.baseUrl} label="SCIM base URL" />
            </div>

            {created && (
              <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-xs">
                <h3 className="text-sm font-semibold">Copy the token now: it is shown only once. Paste it as the Secret Token / API token at your identity provider.</h3>
                <Copyable value={created} label="SCIM token" />
                <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
                  Done
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Tokens</h3>
              <form
                className="flex flex-wrap items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!name.trim()) return
                  void act(async () => (setCreated((await createScimToken(name)).token), setName(''), ''))
                }}
              >
                <Label htmlFor={`${id}-name`} className="sr-only">
                  Token name
                </Label>
                <Input id={`${id}-name`} className="w-72 max-w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder="Token name, e.g. Entra ID provisioning" />
                <Button type="submit" size="sm" disabled={busy || !name.trim()}>
                  <Plus aria-hidden /> Create token
                </Button>
              </form>
              {data.tokens.length > 0 && (
                <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="SCIM tokens">
                  {data.tokens.map((t) => (
                    <li key={t.id} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-medium">{t.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{t.prefix}…</span>
                      <StateMark state={t.revokedAt ? 'tripped' : 'live'} className="text-xs">
                        {t.revokedAt ? 'Revoked' : 'Active'}
                      </StateMark>
                      <span className="font-mono text-xs text-muted-foreground">
                        {t.revokedAt ? formatWhen(t.revokedAt) : `last used ${t.lastUsedAt ? formatWhen(t.lastUsedAt) : 'never'}`}
                      </span>
                      {!t.revokedAt && (
                        <Button
                          size="sm"
                          variant="destructive"
                          className="ml-auto"
                          disabled={busy}
                          aria-label={`Revoke SCIM token ${t.name}`}
                          onClick={async () => {
                            const ok = await confirm({
                              title: `Revoke SCIM token "${t.name}"?`,
                              description: 'Provisioning with it stops right away. To rotate, create a new token first and paste it at your identity provider, then revoke this one.',
                              confirmLabel: 'Revoke token',
                              tone: 'danger',
                            })
                            if (ok) void act(async () => (await revokeScimToken(t.id), 'Token revoked: provisioning with it stops now.'))
                          }}
                        >
                          Revoke
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {!active.length && (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StateMark state="idle" className="text-xs">
                    Provisioning off
                  </StateMark>
                  No active token.
                </p>
              )}
            </div>

            {data.groups.length > 0 && (
              <div>
                <h3 className="mb-1 text-sm font-semibold">Groups from your identity provider</h3>
                <p className="mb-2 text-xs text-muted-foreground">Give a group a role and its members get it (the highest of their groups). Groups without a role leave roles alone.</p>
                <ul className="divide-y divide-border rounded-md border border-border text-sm">
                  {data.groups.map((g) => (
                    <li key={g.id} className="flex flex-wrap items-center gap-2 p-2">
                      <span className="font-medium">{g.displayName}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {g.members} member{g.members === 1 ? '' : 's'}
                      </span>
                      <select
                        className={`${nativeSelectClass} ml-auto`}
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
                <summary className="cursor-pointer text-info-text">
                  {data.users.length} provisioned {data.users.length === 1 ? 'person' : 'people'} ({data.users.filter((u) => !u.active).length} deactivated)
                </summary>
                <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-xs">
                  {data.users.map((u) => (
                    <li key={u.id} className="flex gap-2">
                      <span className={u.active ? '' : 'text-muted-foreground line-through'}>{u.email}</span>
                      <span className="text-muted-foreground">
                        {u.active ? 'active' : 'deactivated'} · <span className="font-mono">{formatWhen(u.updatedAt)}</span>
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
