'use client'

import { useCallback, useEffect, useState } from 'react'
import { CheckCircle2, Copy, Download, Loader2, Plus, Server } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { addAgentDataSource, createAgent, listAgents, revokeAgent } from '@/lib/actions/agents'
import { formatWhen } from '@/components/pipelines/run-history'

type Data = Awaited<ReturnType<typeof listAgents>>

function CopyBlock({ value, label, rows = 1 }: { value: string; label: string; rows?: number }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-1">
      {rows > 1 ? (
        <textarea readOnly value={value} rows={rows} className="w-full rounded-md border border-input bg-background p-2 font-mono text-xs" aria-label={label} onFocus={(e) => e.target.select()} />
      ) : (
        <Input readOnly value={value} className="h-8 font-mono text-xs" aria-label={label} onFocus={(e) => e.target.select()} />
      )}
      <Button size="sm" variant="outline" className="h-8" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={`Copy ${label}`}>
        {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}

/**
 * Settings → Nexus Agents (#13): reach databases behind a firewall. The agent
 * runs inside the customer's network, connects out to Nexus, and keeps the
 * database credentials in its own config.
 */
export function AgentsSettings() {
  const [data, setData] = useState<Data | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ token: string; config: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const load = useCallback(async () => {
    try {
      setData(await listAgents())
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not load agents' })
    }
  }, [])

  useEffect(() => {
    void load()
    // Online status changes while the page is open.
    const t = setInterval(() => void load(), 30_000)
    return () => clearInterval(t)
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

  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label="Nexus Agents">
      <div className="flex items-start gap-3">
        <Server className="mt-0.5 h-5 w-5 text-primary" />
        <div>
          <h3 className="font-semibold">Nexus Agents</h3>
          <p className="text-sm text-muted-foreground">
            Reach databases behind your firewall. The agent runs on a server in your network (Node 20+), only connects out to Nexus over HTTPS, and keeps the database passwords in its own config: Nexus never stores them. It can also run an open-source AI model next to your data.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input className="h-9 max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="Agent name, e.g. Jakarta office" aria-label="Agent name" />
        <Button size="sm" disabled={busy || !name.trim()} onClick={() => void act(async () => { const r = await createAgent(name); setCreated({ token: r.token, config: r.config }); setName('') })}>
          <Plus className="mr-1 h-4 w-4" /> Create agent
        </Button>
        <a href="/downloads/nexus-agent.mjs" download className="inline-flex h-9 items-center rounded-md border border-border px-3 text-sm hover:bg-muted">
          <Download className="mr-1 h-4 w-4" /> Download agent
        </a>
      </div>

      {created && (
        <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <p className="font-medium">Save this config as nexus-agent.json next to nexus-agent.mjs. The token is shown only once.</p>
          <CopyBlock value={created.config} label="Agent config" rows={9} />
          <p>
            Put each database&apos;s password in an environment variable (the config refers to it as <span className="font-mono">{'${HR_DB_URL}'}</span>), list your connections, then run:
          </p>
          <CopyBlock value="node nexus-agent.mjs --config nexus-agent.json --check" label="Check command" />
          <CopyBlock value="node nexus-agent.mjs --config nexus-agent.json" label="Run command" />
          <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
            Done
          </Button>
        </div>
      )}

      {!data ? (
        <p className="text-sm text-muted-foreground">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : data.agents.length === 0 ? (
        <p className="text-sm text-muted-foreground">No agents yet.</p>
      ) : (
        <ul className="space-y-3">
          {data.agents.map((a) => (
            <li key={a.id} className={`space-y-2 rounded-md border border-border p-3 text-sm ${a.revokedAt ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${a.online ? 'bg-green-500' : 'bg-muted-foreground/40'}`} aria-hidden />
                <span className="font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">
                  {a.revokedAt ? `revoked ${formatWhen(a.revokedAt)}` : a.online ? 'online' : a.lastSeenAt ? `offline, last seen ${formatWhen(a.lastSeenAt)}` : 'never connected'}
                  {a.version ? ` · v${a.version}` : ''}
                  {a.hostname ? ` · ${a.hostname}` : ''}
                  {a.ai ? ` · AI model ${a.ai.model}` : ''}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{a.prefix}…</span>
                {!a.revokedAt && (
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => void act(async () => (await revokeAgent(a.id), `${a.name} revoked: it can no longer connect.`))}>
                    Revoke
                  </Button>
                )}
              </div>
              {a.connections.length > 0 ? (
                <ul className="divide-y divide-border rounded-md border border-border">
                  {a.connections.map((c) => (
                    <li key={c.name} className="flex flex-wrap items-center gap-2 p-2 text-xs">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-muted-foreground">
                        {c.type}
                        {c.writable ? ' · writable' : ' · read-only'}
                      </span>
                      {c.dataSources.length > 0 && <span className="text-muted-foreground">used by {c.dataSources.map((d) => d.name).join(', ')}</span>}
                      {!a.revokedAt && (
                        <span className="ml-auto flex gap-1">
                          <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void act(async () => `Added "${(await addAgentDataSource({ agentId: a.id, connection: c.name, role: 'source' })).name}" to Data Sources. Test it there to scan its tables.`)}>
                            Add as source
                          </Button>
                          {c.writable && (
                            <Button size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void act(async () => `Added "${(await addAgentDataSource({ agentId: a.id, connection: c.name, role: 'destination', name: `${c.name} (destination via ${a.name})` })).name}" as a destination.`)}>
                              Add as destination
                            </Button>
                          )}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                !a.revokedAt && <p className="text-xs text-muted-foreground">Its connections appear here once the agent has started.</p>
              )}
            </li>
          ))}
        </ul>
      )}
      {message?.text && <p className={`rounded-md p-2 text-sm ${message.kind === 'ok' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>{message.text}</p>}
    </section>
  )
}
