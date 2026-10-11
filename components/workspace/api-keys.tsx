'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeySquare, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { createApiKey, listApiKeys, revokeApiKey } from '@/lib/actions/api-keys'
import { NativeSelect } from '@/components/pipelines/step-editors'
import { formatWhen } from '@/components/pipelines/run-history'

type Key = Awaited<ReturnType<typeof listApiKeys>>[number]

/** Data API keys (API-1): admins create scoped keys (shown once) and revoke them. */
export function ApiKeys() {
  const [keys, setKeys] = useState<Key[] | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState<'analyst' | 'steward'>('analyst')
  const [scopes, setScopes] = useState<string[]>(['datasets:read', 'domains:read'])
  const [expires, setExpires] = useState('365')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setKeys(await listApiKeys())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load API keys')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await createApiKey({ name, role, scopes: scopes as ('datasets:read' | 'domains:read')[], expiresInDays: expires ? Number(expires) : null })
      setCreated(res.key)
      setCopied(false)
      setCreating(false)
      setName('')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the key')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    try {
      await revokeApiKey(id)
      setConfirm(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Data API keys">
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <KeySquare className="mt-0.5 h-5 w-5 text-primary" />
        <div className="flex-1">
          <h3 className="font-semibold">Data API keys</h3>
          <p className="text-sm text-muted-foreground">
            Apps read datasets and business entities over HTTPS with a key: <span className="font-mono text-xs">GET {origin}/api/v1/datasets/&lt;name&gt;</span> or <span className="font-mono text-xs">/api/v1/domains/employee</span>. Masking and row-level access follow the key&apos;s role.
          </p>
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-1 h-4 w-4" /> New key
          </Button>
        )}
      </div>

      {created && (
        <div className="mb-3 space-y-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm" role="status">
          <div className="font-medium">Copy the key now. It won&apos;t be shown again.</div>
          <div className="flex gap-2">
            <Input readOnly value={created} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="New API key" />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(created).then(() => setCopied(true))
              }}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>Done</Button>
          </div>
          <div className="font-mono text-xs text-muted-foreground">curl -H &quot;Authorization: Bearer {created.slice(0, 12)}…&quot; {origin}/api/v1/datasets</div>
        </div>
      )}

      {creating && (
        <div className="mb-3 grid gap-3 rounded-md border border-border p-3 md:grid-cols-4">
          <label className="text-sm md:col-span-2">
            <span className="mb-1 block text-xs text-muted-foreground">Name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="KMS production" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Reads as</span>
            <NativeSelect value={role} onChange={(v) => setRole(v as 'analyst' | 'steward')}>
              <option value="analyst">Analyst (masked personal data)</option>
              <option value="steward">Data steward (real values)</option>
            </NativeSelect>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted-foreground">Expires</span>
            <NativeSelect value={expires} onChange={setExpires}>
              <option value="30">in 30 days</option>
              <option value="90">in 90 days</option>
              <option value="365">in 1 year</option>
              <option value="">never</option>
            </NativeSelect>
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-4">
            {[
              ['datasets:read', 'Read datasets'],
              ['domains:read', 'Read business entities'],
            ].map(([s, label]) => (
              <label key={s} className="flex items-center gap-1.5">
                <input type="checkbox" checked={scopes.includes(s)} onChange={(e) => setScopes(e.target.checked ? [...scopes, s] : scopes.filter((x) => x !== s))} />
                {label}
              </label>
            ))}
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
            <Button size="sm" onClick={() => void create()} disabled={busy || !name.trim() || !scopes.length}>
              {busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Create key
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mb-3 rounded-md bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}

      {!keys ? (
        <p className="flex items-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…</p>
      ) : keys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No API keys yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border text-sm">
          {keys.map((k) => {
            const expired = k.expiresAt && new Date(k.expiresAt).getTime() < Date.now()
            return (
              <li key={k.id} className={`flex flex-wrap items-center gap-2 p-2 ${k.revokedAt || expired ? 'opacity-60' : ''}`}>
                <span className="font-medium">{k.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
                <Badge variant="outline">{k.role}</Badge>
                {k.scopes.map((s) => (
                  <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                ))}
                {k.revokedAt ? <Badge variant="destructive">revoked</Badge> : expired ? <Badge variant="destructive">expired</Badge> : null}
                <span className="flex-1 text-xs text-muted-foreground">
                  by {k.createdByEmail ?? 'unknown'} · last used {k.lastUsedAt ? formatWhen(k.lastUsedAt) : 'never'}
                  {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ' · never expires'}
                </span>
                {!k.revokedAt &&
                  (confirm === k.id ? (
                    <span className="flex items-center gap-1 text-xs">
                      Apps using it stop working.
                      <Button size="sm" variant="destructive" onClick={() => void revoke(k.id)}>Revoke</Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>Cancel</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(k.id)}>Revoke</Button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
