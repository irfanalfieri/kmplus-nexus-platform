'use client'

import { useCallback, useEffect, useState } from 'react'
import { GitBranch, Loader2, Lock, ShieldCheck, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getEnvironments, linkEnvironment, setApprovalPolicy, setEnvironmentLock, setupEnvironments, unlinkEnvironment } from '@/lib/actions/environments'
import { switchWorkspace } from '@/lib/actions/workspaces'
import { APPROVAL_POLICIES, APPROVAL_POLICY_INFO, type ApprovalPolicy } from '@/lib/pipelines/approvals'
import { ENVIRONMENTS, ENVIRONMENT_INFO, type Environment } from '@/lib/pipelines/promote'
import { ROLE_INFO, isRole } from '@/lib/auth/permissions'
import { EnvironmentBadge } from './environment-badge'

type Info = Awaited<ReturnType<typeof getEnvironments>>

const selectClass = 'h-9 rounded-md border border-input bg-background px-2 text-sm'

/**
 * Settings → Approvals & environments (GV-6, GV-7). Admins choose who must
 * approve publishes, and link workspaces as Development → Staging → Production
 * so pipelines are promoted between them with each environment's own credentials.
 */
export function EnvironmentsSettings() {
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [setupEnv, setSetupEnv] = useState<Environment>('dev')
  const [create, setCreate] = useState<Environment[]>(['staging', 'prod'])
  const [linkId, setLinkId] = useState('')
  const [linkEnv, setLinkEnv] = useState<Environment>('staging')

  const load = useCallback(async () => {
    try {
      setInfo(await getEnvironments())
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Could not load environments' })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (action: () => Promise<unknown>, ok: string, reload = false) => {
    setBusy(true)
    setMessage(null)
    try {
      await action()
      if (reload) return window.location.reload()
      setMessage({ kind: 'ok', text: ok })
      await load()
    } catch (err) {
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setBusy(false)
    }
  }

  if (!info) {
    return (
      <section className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Loading approvals & environments…
      </section>
    )
  }

  const { current, group } = info
  const usedEnvs = group.map((g) => g.environment)
  const freeEnvs = ENVIRONMENTS.filter((e) => !usedEnvs.includes(e))

  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-5">
      <div>
        <h3 className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="h-4 w-4 text-primary" /> Publish approvals
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">A second person (admin or data steward) approves pipeline versions before they run. Nobody approves their own change.</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={selectClass} value={current.publishApproval} disabled={busy} onChange={(e) => void act(() => setApprovalPolicy(e.target.value as ApprovalPolicy), 'Approval setting saved.', true)} aria-label="Publish approvals">
            {APPROVAL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {APPROVAL_POLICY_INFO[p].label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{APPROVAL_POLICY_INFO[current.publishApproval].description}</span>
        </div>
        {current.approvers < 2 && <p className="mt-2 text-xs text-muted-foreground">Needs at least two admins or data stewards in this workspace ({current.approvers} now).</p>}
      </div>

      <div className="border-t border-border pt-5">
        <h3 className="flex items-center gap-2 font-semibold">
          <GitBranch className="h-4 w-4 text-primary" /> Environments
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Link workspaces as Development → Staging → Production. Each keeps its own members, data sources and credentials; pipelines move forward with Promote, which matches data sources by name. Production starts locked, so its pipelines change only by promotion.
        </p>

        {!current.environment ? (
          <div className="mt-3 space-y-3 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span>This workspace is</span>
              <select className={selectClass} value={setupEnv} onChange={(e) => (setSetupEnv(e.target.value as Environment), setCreate(ENVIRONMENTS.filter((x) => x !== e.target.value && create.includes(x))))} aria-label="This workspace's environment">
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {ENVIRONMENT_INFO[e].label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-wrap gap-3">
              {ENVIRONMENTS.filter((e) => e !== setupEnv).map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input type="checkbox" checked={create.includes(e)} onChange={(ev) => setCreate(ev.target.checked ? [...create, e] : create.filter((x) => x !== e))} />
                  Create a {ENVIRONMENT_INFO[e].label} workspace
                </label>
              ))}
            </div>
            <Button size="sm" disabled={busy} onClick={() => void act(() => setupEnvironments({ environment: setupEnv, create }), 'Environments set up.', true)}>
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Set up environments
            </Button>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border text-sm">
              {group.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 p-3">
                  <EnvironmentBadge environment={g.environment} />
                  <span className="font-medium">{g.name}</span>
                  {g.id === current.id && <span className="text-xs text-muted-foreground">(this workspace)</span>}
                  {g.locked && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="h-3 w-3" /> locked
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">approvals: {APPROVAL_POLICY_INFO[(APPROVAL_POLICIES as readonly string[]).includes(g.publishApproval) ? (g.publishApproval as ApprovalPolicy) : 'off'].label.toLowerCase()}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{g.role && isRole(g.role) ? `you: ${ROLE_INFO[g.role].label}` : 'not a member'}</span>
                  {g.id !== current.id && g.role && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => switchWorkspace(g.id), '', true)}>
                      Open
                    </Button>
                  )}
                  {g.role === 'admin' && (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => void act(() => unlinkEnvironment(g.id), `${g.name} left the group.`, g.id === current.id)}>
                      Unlink
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(() => setEnvironmentLock(!current.locked), current.locked ? 'Unlocked: pipelines can be edited here.' : 'Locked: pipelines change only by promotion.', true)}>
                {current.locked ? <Unlock className="mr-1 h-4 w-4" /> : <Lock className="mr-1 h-4 w-4" />}
                {current.locked ? 'Unlock this workspace' : 'Lock this workspace'}
              </Button>
              {info.next ? (
                <span className="text-xs text-muted-foreground">
                  Pipelines here promote to {ENVIRONMENT_INFO[info.next.environment].label} ({info.next.name}){info.next.member ? '' : ': ask its admin to add you as an editor'}.
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">This is the last environment.</span>
              )}
            </div>
            {freeEnvs.length > 0 && info.linkable.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span>Link</span>
                <select className={selectClass} value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label="Workspace to link">
                  <option value="">a workspace you administer…</option>
                  {info.linkable.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <span>as</span>
                <select className={selectClass} value={freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0]} onChange={(e) => setLinkEnv(e.target.value as Environment)} aria-label="Its environment">
                  {freeEnvs.map((e) => (
                    <option key={e} value={e}>
                      {ENVIRONMENT_INFO[e].label}
                    </option>
                  ))}
                </select>
                <Button size="sm" variant="outline" disabled={busy || !linkId} onClick={() => void act(() => linkEnvironment({ workspaceId: linkId, environment: freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0] }), 'Workspace linked.')}>
                  Link
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
      {message?.text && <p className={`rounded-md p-2 text-sm ${message.kind === 'ok' ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-destructive/10 text-destructive'}`}>{message.text}</p>}
    </section>
  )
}
