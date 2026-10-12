'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { Loader2, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { useConfirm } from '@/components/ui/dialog'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { getEnvironments, linkEnvironment, setApprovalPolicy, setEnvironmentLock, setupEnvironments, unlinkEnvironment } from '@/lib/actions/environments'
import { switchWorkspace } from '@/lib/actions/workspaces'
import { APPROVAL_POLICIES, APPROVAL_POLICY_INFO, type ApprovalPolicy } from '@/lib/pipelines/approvals'
import { ENVIRONMENTS, ENVIRONMENT_INFO, type Environment } from '@/lib/pipelines/promote'
import { ROLE_INFO, isRole } from '@/lib/auth/permissions'
import { EnvironmentBadge } from './environment-badge'

type Info = Awaited<ReturnType<typeof getEnvironments>>

/**
 * Settings → Approvals & environments (GV-6, GV-7). Admins choose who must
 * approve publishes, and link workspaces as Development → Staging → Production
 * so pipelines are promoted between them with each environment's own credentials.
 */
export function EnvironmentsSettings() {
  const id = useId()
  const [info, setInfo] = useState<Info | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [setupEnv, setSetupEnv] = useState<Environment>('dev')
  const [create, setCreate] = useState<Environment[]>(['staging', 'prod'])
  const [linkId, setLinkId] = useState('')
  const [linkEnv, setLinkEnv] = useState<Environment>('staging')
  const [confirm, confirmEl] = useConfirm()

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

  const messageEl = message?.text ? <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice> : null

  if (!info) {
    return (
      <SettingsPanel title="Publish approvals & environments">
        {message?.kind === 'err' ? (
          messageEl
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> Loading approvals & environments…
          </p>
        )}
      </SettingsPanel>
    )
  }

  const { current, group } = info
  const usedEnvs = group.map((g) => g.environment)
  const freeEnvs = ENVIRONMENTS.filter((e) => !usedEnvs.includes(e))

  return (
    <>
      <SettingsPanel title="Publish approvals" description="A second person (admin or data steward) approves pipeline versions before they run. Nobody approves their own change.">
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`${id}-policy`} className="sr-only">
            Publish approvals
          </Label>
          <select
            id={`${id}-policy`}
            className={nativeSelectClass}
            value={current.publishApproval}
            disabled={busy}
            onChange={(e) => void act(() => setApprovalPolicy(e.target.value as ApprovalPolicy), 'Approval setting saved.', true)}
          >
            {APPROVAL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {APPROVAL_POLICY_INFO[p].label}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{APPROVAL_POLICY_INFO[current.publishApproval].description}</span>
        </div>
        {current.approvers < 2 && (
          <Notice tone="warning" className="mt-3" live={false}>
            Needs at least two admins or data stewards in this workspace (<span className="font-mono">{current.approvers}</span> now).
          </Notice>
        )}
      </SettingsPanel>

      <SettingsPanel
        title="Environments"
        description="Link workspaces as Development → Staging → Production. Each keeps its own members, data sources and credentials; pipelines move forward with Promote, which matches data sources by name. Production starts locked, so its pipelines change only by promotion."
      >
        {!current.environment ? (
          <div className="space-y-3 rounded-md border border-border p-3 text-sm">
            <h3 className="font-semibold">Set up environments</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`${id}-setup`} className="font-normal">
                This workspace is
              </Label>
              <select
                id={`${id}-setup`}
                className={nativeSelectClass}
                value={setupEnv}
                onChange={(e) => (setSetupEnv(e.target.value as Environment), setCreate(ENVIRONMENTS.filter((x) => x !== e.target.value && create.includes(x))))}
              >
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {ENVIRONMENT_INFO[e].label}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="sr-only">Workspaces to create</legend>
              {ENVIRONMENTS.filter((e) => e !== setupEnv).map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={create.includes(e)}
                    onChange={(ev) => setCreate(ev.target.checked ? [...create, e] : create.filter((x) => x !== e))}
                  />
                  Create a {ENVIRONMENT_INFO[e].label} workspace
                </label>
              ))}
            </fieldset>
            <Button size="sm" disabled={busy} onClick={() => void act(() => setupEnvironments({ environment: setupEnv, create }), 'Environments set up.', true)}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} Set up environments
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label="Linked environments">
              {group.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 p-3">
                  <EnvironmentBadge environment={g.environment} />
                  <span className="font-medium">{g.name}</span>
                  {g.id === current.id && <span className="text-xs text-muted-foreground">(this workspace)</span>}
                  {g.locked && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden /> locked
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    approvals:{' '}
                    {APPROVAL_POLICY_INFO[(APPROVAL_POLICIES as readonly string[]).includes(g.publishApproval) ? (g.publishApproval as ApprovalPolicy) : 'off'].label.toLowerCase()}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{g.role && isRole(g.role) ? `you: ${ROLE_INFO[g.role].label}` : 'not a member'}</span>
                  {g.id !== current.id && g.role && (
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={`Open ${g.name}`} onClick={() => void act(() => switchWorkspace(g.id), '', true)}>
                      Open
                    </Button>
                  )}
                  {g.role === 'admin' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Unlink ${g.name}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: `Unlink ${g.name} from the environment group?`,
                          description: 'Pipelines can no longer be promoted to or from it. Its data and pipelines stay as they are.',
                          confirmLabel: 'Unlink',
                          tone: 'danger',
                        })
                        if (ok) void act(() => unlinkEnvironment(g.id), `${g.name} left the group.`, g.id === current.id)
                      }}
                    >
                      Unlink
                    </Button>
                  )}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={async () => {
                  if (current.locked) {
                    const ok = await confirm({
                      title: 'Unlock this workspace?',
                      description: 'Pipelines here can then be edited directly instead of only by promotion.',
                      confirmLabel: 'Unlock',
                      tone: 'danger',
                    })
                    if (!ok) return
                  }
                  void act(() => setEnvironmentLock(!current.locked), current.locked ? 'Unlocked: pipelines can be edited here.' : 'Locked: pipelines change only by promotion.', true)
                }}
              >
                {current.locked ? <Unlock aria-hidden /> : <Lock aria-hidden />}
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
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                <h3 className="sr-only">Link a workspace</h3>
                <Label htmlFor={`${id}-link`} className="font-normal">
                  Link
                </Label>
                <select id={`${id}-link`} className={nativeSelectClass} value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label="Workspace to link">
                  <option value="">a workspace you administer…</option>
                  {info.linkable.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <span aria-hidden>as</span>
                <select className={nativeSelectClass} value={freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0]} onChange={(e) => setLinkEnv(e.target.value as Environment)} aria-label="Its environment">
                  {freeEnvs.map((e) => (
                    <option key={e} value={e}>
                      {ENVIRONMENT_INFO[e].label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !linkId}
                  onClick={() => void act(() => linkEnvironment({ workspaceId: linkId, environment: freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0] }), 'Workspace linked.')}
                >
                  Link
                </Button>
              </div>
            )}
          </div>
        )}
      </SettingsPanel>
      {messageEl}
      {confirmEl}
    </>
  )
}
