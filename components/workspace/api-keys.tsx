'use client'

import { useCallback, useEffect, useId, useState } from 'react'
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
import { formatWhen } from '@/components/pipelines/run-history'

type Key = Awaited<ReturnType<typeof listApiKeys>>[number]

/** Data API keys (API-1): admins create scoped keys (shown once) and revoke them. */
export function ApiKeys() {
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
      setError(err instanceof Error ? err.message : 'Could not create the key')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (k: Key) => {
    const ok = await confirm({
      title: `Revoke API key "${k.name}"?`,
      description: 'Apps using it stop working right away. This cannot be undone.',
      confirmLabel: 'Revoke key',
      tone: 'danger',
    })
    if (!ok) return
    try {
      await revokeApiKey(k.id)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revoke failed')
    }
  }

  const origin = typeof window === 'undefined' ? '' : window.location.origin

  return (
    <SettingsPanel
      title="Data API keys"
      description={
        <>
          Apps read datasets and business entities, start pipelines and follow runs over HTTPS with a key: <span className="font-mono text-xs">GET {origin}/api/v1/datasets/&lt;name&gt;</span>,{' '}
          <span className="font-mono text-xs">/api/v1/domains/employee</span>, <span className="font-mono text-xs">POST /api/v1/pipelines/&lt;id&gt;/runs</span>. Masking and row-level access follow the key&apos;s role; each key has a per-minute request
          limit.{' '}
          <a className="text-info-text underline-offset-4 hover:underline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">
            OpenAPI spec
          </a>
        </>
      }
    >
      <div className="space-y-3">
        {!creating && (
          <Button onClick={() => setCreating(true)}>
            <Plus aria-hidden /> New key
          </Button>
        )}

        {created && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-sm" role="status">
            <h3 className="font-semibold">Copy the key now. It won&apos;t be shown again.</h3>
            <div className="flex gap-2">
              <Input readOnly value={created} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="New API key" />
              <Button
                size="icon"
                variant="outline"
                aria-label={copied ? 'API key copied' : 'Copy API key'}
                onClick={() => {
                  void navigator.clipboard.writeText(created).then(() => setCopied(true))
                }}
              >
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
              <Button variant="ghost" onClick={() => setCreated(null)}>
                Done
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
            <h3 className="text-sm font-semibold md:col-span-4">New API key</h3>
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor={`${id}-name`}>Name</Label>
              <Input id={`${id}-name`} value={name} onChange={(e) => setName(e.target.value)} placeholder="KMS production" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-role`}>Reads as</Label>
              <select id={`${id}-role`} className={`${nativeSelectClass} w-full`} value={role} onChange={(e) => setRole(e.target.value as 'analyst' | 'steward')}>
                <option value="analyst">Analyst (masked personal data)</option>
                <option value="steward">Data steward (real values)</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-expires`}>Expires</Label>
              <select id={`${id}-expires`} className={`${nativeSelectClass} w-full`} value={expires} onChange={(e) => setExpires(e.target.value)}>
                <option value="30">in 30 days</option>
                <option value="90">in 90 days</option>
                <option value="365">in 1 year</option>
                <option value="">never</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm md:col-span-4">
              <div className="flex items-center gap-1.5">
                <Label htmlFor={`${id}-rate`}>Limit</Label>
                <select id={`${id}-rate`} className={`${nativeSelectClass} w-36`} value={rate} onChange={(e) => setRate(e.target.value)} aria-label="Requests per minute">
                  {['60', '120', '300', '600', '1200'].map((r) => (
                    <option key={r} value={r}>
                      {r} / minute
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="flex flex-wrap items-center gap-3">
                <legend className="sr-only">Scopes</legend>
                {[
                  ['datasets:read', 'Read datasets'],
                  ['domains:read', 'Read business entities'],
                  ['pipelines:run', 'Run pipelines'],
                  ['runs:read', 'Read run status'],
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
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={busy || !name.trim() || !scopes.length}>
                {busy && <Loader2 className="animate-spin" aria-hidden />} Create key
              </Button>
            </div>
          </form>
        )}

        {error && <Notice tone="danger">{error}</Notice>}

        {!keys ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading…
          </p>
        ) : keys.length === 0 ? (
          <EmptyState compact icon={<KeySquare />} title="No API keys yet">
            Create a key for each app that reads Nexus data, so you can revoke one without touching the others.
          </EmptyState>
        ) : (
          <div className="-mx-5 border-y border-border">
            <Table label="Data API keys" className="min-w-[720px]">
              <THead>
                <tr>
                  <Th className="pl-5">Key</Th>
                  <Th>Access</Th>
                  <Th>Status</Th>
                  <Th>Usage</Th>
                  <Th className="pr-5">
                    <span className="sr-only">Actions</span>
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
                          {k.role} · <span className="font-mono">{k.rateLimitPerMinute}/min</span>
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
                          {k.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Active'}
                        </StateMark>
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        <div>by {k.createdByEmail ?? 'unknown'}</div>
                        <div className="font-mono">
                          last used {k.lastUsedAt ? formatWhen(k.lastUsedAt) : 'never'}
                          {k.expiresAt ? ` · expires ${new Date(k.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}` : ' · never expires'}
                        </div>
                      </Td>
                      <Td className="pr-5 text-right">
                        {!k.revokedAt && (
                          <Button size="sm" variant="destructive" aria-label={`Revoke API key ${k.name}`} onClick={() => void revoke(k)}>
                            Revoke
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
