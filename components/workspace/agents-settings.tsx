'use client'

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
import { CheckCircle2, Copy, Download, Loader2, Plus, Server } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { useConfirm } from '@/components/ui/dialog'
import { StateMark } from '@/components/ui/flow-line'
import { SettingsPanel } from '@/components/workspace/settings-panel'
import { addAgentDataSource, createAgent, listAgents, revokeAgent } from '@/lib/actions/agents'
import { useT, usePrefs } from '@/components/i18n/i18n-provider'

type Data = Awaited<ReturnType<typeof listAgents>>

/** Short date and time in WIB, in the interface language. */
const WHEN: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

function CopyBlock({ value, label, rows = 1 }: { value: string; label: string; rows?: number }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-start gap-1">
      {rows > 1 ? (
        <textarea
          readOnly
          value={value}
          rows={rows}
          className="w-full rounded-md border border-input bg-card p-2 font-mono text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          aria-label={label}
          onFocus={(e) => e.target.select()}
        />
      ) : (
        <Input readOnly value={value} className="bg-card font-mono text-xs" aria-label={label} onFocus={(e) => e.target.select()} />
      )}
      <Button size="icon" variant="outline" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))} aria-label={copied ? t('ws.common.copiedLabel', { label }) : t('ws.common.copyLabel', { label })}>
        {copied ? <CheckCircle2 aria-hidden /> : <Copy aria-hidden />}
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
  const { t, formatDateTime } = usePrefs()
  const when = (v: Date | string) => `${formatDateTime(v, WHEN)} WIB`
  const nameId = useId()
  const [data, setData] = useState<Data | null>(null)
  const [name, setName] = useState('')
  const [created, setCreated] = useState<{ token: string; config: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [confirm, confirmEl] = useConfirm()

  const load = useCallback(async () => {
    try {
      setData(await listAgents())
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('ws.agents.loadFailed') })
    }
  }, [t])

  useEffect(() => {
    void load()
    // Online status changes while the page is open.
    const timer = setInterval(() => void load(), 30_000)
    return () => clearInterval(timer)
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

  return (
    <SettingsPanel
      title={t('ws.agents.title')}
      description={t('ws.agents.description')}
    >
      <div className="space-y-4">
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!name.trim()) return
            void act(async () => {
              const r = await createAgent(name)
              setCreated({ token: r.token, config: r.config })
              setName('')
            })
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor={nameId}>{t('ws.agents.nameLabel')}</Label>
            <Input id={nameId} className="w-72 max-w-full" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('ws.agents.namePlaceholder')} />
          </div>
          <Button type="submit" disabled={busy || !name.trim()}>
            <Plus aria-hidden /> {t('ws.agents.create')}
          </Button>
          <a href="/downloads/nexus-agent.mjs" download className={buttonVariants({ variant: 'outline' })}>
            <Download aria-hidden /> {t('ws.agents.download')}
          </a>
        </form>

        {created && (
          <div className="space-y-2 rounded-md border border-warning/50 bg-warning-soft p-3 text-xs">
            <h3 className="text-sm font-semibold">{t('ws.agents.configOnce')}</h3>
            <CopyBlock value={created.config} label={t('ws.agents.configLabel')} rows={9} />
            <p>{rich(t('ws.agents.envHint'), { example: <span className="font-mono">{'${HR_DB_URL}'}</span> })}</p>
            <CopyBlock value="node nexus-agent.mjs --config nexus-agent.json --check" label={t('ws.agents.checkCommand')} />
            <CopyBlock value="node nexus-agent.mjs --config nexus-agent.json" label={t('ws.agents.runCommand')} />
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              {t('ws.common.done')}
            </Button>
          </div>
        )}

        {message?.text && <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice>}

        {!data ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : data.agents.length === 0 ? (
          <EmptyState compact icon={<Server />} title={t('ws.agents.emptyTitle')}>
            {t('ws.agents.emptyBody')}
          </EmptyState>
        ) : (
          <ul className="space-y-3">
            {data.agents.map((a) => (
              <li key={a.id} className={cn('space-y-2 rounded-md border border-border p-3 text-sm', a.revokedAt && 'opacity-70')}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h3 className="font-medium">{a.name}</h3>
                  <StateMark state={a.revokedAt ? 'tripped' : a.online ? 'live' : 'idle'} className="text-xs">
                    {a.revokedAt ? t('ws.common.revoked') : a.online ? t('ws.agents.online') : a.lastSeenAt ? t('ws.agents.offline') : t('ws.agents.neverConnected')}
                  </StateMark>
                  <span className="text-xs text-muted-foreground">
                    {a.revokedAt ? t('ws.agents.revokedAt', { when: when(a.revokedAt) }) : !a.online && a.lastSeenAt ? t('ws.agents.lastSeen', { when: when(a.lastSeenAt) }) : ''}
                    {a.version ? <span className="font-mono"> · v{a.version}</span> : null}
                    {a.hostname ? <span className="font-mono"> · {a.hostname}</span> : null}
                    {a.ai ? ` · ${t('ws.agents.aiModel', { model: a.ai.model })}` : ''}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{a.prefix}…</span>
                  {!a.revokedAt && (
                    <Button
                      size="sm"
                      variant="destructive"
                      className="ml-auto"
                      disabled={busy}
                      aria-label={t('ws.agents.revokeLabel', { name: a.name })}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t('ws.agents.revokeTitle', { name: a.name }),
                          description: t('ws.agents.revokeBody'),
                          confirmLabel: t('ws.agents.revokeConfirm'),
                          tone: 'danger',
                        })
                        if (ok) void act(async () => (await revokeAgent(a.id), t('ws.agents.revokedDone', { name: a.name })))
                      }}
                    >
                      {t('ws.common.revoke')}
                    </Button>
                  )}
                </div>
                {a.connections.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border" aria-label={t('ws.agents.connectionsOf', { name: a.name })}>
                    {a.connections.map((c) => (
                      <li key={c.name} className="flex flex-wrap items-center gap-2 p-2 text-xs">
                        <span className="font-mono font-medium">{c.name}</span>
                        <span className="text-muted-foreground">
                          {c.type}
                          {` · ${c.writable ? t('ws.agents.writable') : t('ws.agents.readOnly')}`}
                        </span>
                        {c.dataSources.length > 0 && <span className="text-muted-foreground">{t('ws.agents.usedBy', { names: c.dataSources.map((d) => d.name).join(', ') })}</span>}
                        {!a.revokedAt && (
                          <span className="ml-auto flex gap-1">
                            <Button
                              size="xs"
                              variant="outline"
                              disabled={busy}
                              onClick={() =>
                                void act(async () => t('ws.agents.addedSource', { name: (await addAgentDataSource({ agentId: a.id, connection: c.name, role: 'source' })).name }))
                              }
                            >
                              {t('ws.agents.addSource')}
                            </Button>
                            {c.writable && (
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    async () =>
                                      t('ws.agents.addedDestination', {
                                        name: (await addAgentDataSource({ agentId: a.id, connection: c.name, role: 'destination', name: `${c.name} (destination via ${a.name})` })).name,
                                      }),
                                  )
                                }
                              >
                                {t('ws.agents.addDestination')}
                              </Button>
                            )}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  !a.revokedAt && <p className="text-xs text-muted-foreground">{t('ws.agents.connectionsLater')}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {confirmEl}
    </SettingsPanel>
  )
}
