'use client'

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
import { Loader2, Lock, Unlock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { useConfirm } from '@/components/ui/dialog'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { getEnvironments, linkEnvironment, setApprovalPolicy, setEnvironmentLock, setupEnvironments, unlinkEnvironment } from '@/lib/actions/environments'
import { switchWorkspace } from '@/lib/actions/workspaces'
import { APPROVAL_POLICIES, type ApprovalPolicy } from '@/lib/pipelines/approvals'
import { ENVIRONMENTS, type Environment } from '@/lib/pipelines/promote'
import { isRole } from '@/lib/auth/permissions'
import { useT } from '@/components/i18n/i18n-provider'
import { EnvironmentBadge } from './environment-badge'

type Info = Awaited<ReturnType<typeof getEnvironments>>

/** Fills {slots} in a translated sentence with elements. */
function rich(text: string, slots: Record<string, React.ReactNode>) {
  return text.split(/\{(\w+)\}/).map((part, i) => (i % 2 ? <Fragment key={i}>{slots[part] ?? `{${part}}`}</Fragment> : part))
}

/**
 * Settings → Approvals & environments (GV-6, GV-7). Admins choose who must
 * approve publishes, and link workspaces as Development → Staging → Production
 * so pipelines are promoted between them with each environment's own credentials.
 */
export function EnvironmentsSettings() {
  const t = useT()
  const envLabel = (e: Environment) => t(`ws.env.names.${e}` as const)
  const policyLabel = (p: ApprovalPolicy) => t(`ws.env.policies.${p}.label` as const)
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
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('ws.env.loadFailed') })
    }
  }, [t])

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
      setMessage({ kind: 'err', text: err instanceof Error ? err.message : t('ws.common.failed') })
    } finally {
      setBusy(false)
    }
  }

  const messageEl = message?.text ? <Notice tone={message.kind === 'ok' ? 'success' : 'danger'}>{message.text}</Notice> : null

  if (!info) {
    return (
      <SettingsPanel title={t('ws.env.loadingTitle')}>
        {message?.kind === 'err' ? (
          messageEl
        ) : (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('ws.env.loading')}
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
      <SettingsPanel title={t('ws.env.approvalsTitle')} description={t('ws.env.approvalsDescription')}>
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={`${id}-policy`} className="sr-only">
            {t('ws.env.approvalsTitle')}
          </Label>
          <select
            id={`${id}-policy`}
            className={nativeSelectClass}
            value={current.publishApproval}
            disabled={busy}
            onChange={(e) => void act(() => setApprovalPolicy(e.target.value as ApprovalPolicy), t('ws.env.approvalSaved'), true)}
          >
            {APPROVAL_POLICIES.map((p) => (
              <option key={p} value={p}>
                {policyLabel(p)}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">{t(`ws.env.policies.${current.publishApproval}.description` as const)}</span>
        </div>
        {current.approvers < 2 && (
          <Notice tone="warning" className="mt-3" live={false}>
            {rich(t('ws.env.needsApprovers'), { count: <span className="font-mono">{current.approvers}</span> })}
          </Notice>
        )}
      </SettingsPanel>

      <SettingsPanel
        title={t('ws.env.envTitle')}
        description={t('ws.env.envDescription')}
      >
        {!current.environment ? (
          <div className="space-y-3 rounded-md border border-border p-3 text-sm">
            <h3 className="font-semibold">{t('ws.env.setupTitle')}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={`${id}-setup`} className="font-normal">
                {t('ws.env.thisIs')}
              </Label>
              <select
                id={`${id}-setup`}
                className={nativeSelectClass}
                value={setupEnv}
                onChange={(e) => (setSetupEnv(e.target.value as Environment), setCreate(ENVIRONMENTS.filter((x) => x !== e.target.value && create.includes(x))))}
              >
                {ENVIRONMENTS.map((e) => (
                  <option key={e} value={e}>
                    {envLabel(e)}
                  </option>
                ))}
              </select>
            </div>
            <fieldset className="flex flex-wrap gap-3">
              <legend className="sr-only">{t('ws.env.toCreate')}</legend>
              {ENVIRONMENTS.filter((e) => e !== setupEnv).map((e) => (
                <label key={e} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={create.includes(e)}
                    onChange={(ev) => setCreate(ev.target.checked ? [...create, e] : create.filter((x) => x !== e))}
                  />
                  {t('ws.env.createWorkspace', { env: envLabel(e) })}
                </label>
              ))}
            </fieldset>
            <Button size="sm" disabled={busy} onClick={() => void act(() => setupEnvironments({ environment: setupEnv, create }), t('ws.env.setupDone'), true)}>
              {busy && <Loader2 className="animate-spin" aria-hidden />} {t('ws.env.setupButton')}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <ul className="divide-y divide-border rounded-md border border-border text-sm" aria-label={t('ws.env.linked')}>
              {group.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center gap-2 p-3">
                  <EnvironmentBadge environment={g.environment} />
                  <span className="font-medium">{g.name}</span>
                  {g.id === current.id && <span className="text-xs text-muted-foreground">{t('ws.env.thisWorkspace')}</span>}
                  {g.locked && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Lock className="size-3" aria-hidden /> {t('ws.env.locked')}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t('ws.env.approvals', {
                      policy: policyLabel((APPROVAL_POLICIES as readonly string[]).includes(g.publishApproval) ? (g.publishApproval as ApprovalPolicy) : 'off').toLocaleLowerCase(),
                    })}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{g.role && isRole(g.role) ? t('ws.env.you', { role: t(`ws.roles.${g.role}` as const) }) : t('ws.env.notMember')}</span>
                  {g.id !== current.id && g.role && (
                    <Button size="sm" variant="ghost" disabled={busy} aria-label={t('ws.env.openLabel', { name: g.name })} onClick={() => void act(() => switchWorkspace(g.id), '', true)}>
                      {t('ws.env.open')}
                    </Button>
                  )}
                  {g.role === 'admin' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={t('ws.env.unlinkLabel', { name: g.name })}
                      onClick={async () => {
                        const ok = await confirm({
                          title: t('ws.env.unlinkTitle', { name: g.name }),
                          description: t('ws.env.unlinkBody'),
                          confirmLabel: t('ws.env.unlink'),
                          tone: 'danger',
                        })
                        if (ok) void act(() => unlinkEnvironment(g.id), t('ws.env.unlinked', { name: g.name }), g.id === current.id)
                      }}
                    >
                      {t('ws.env.unlink')}
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
                      title: t('ws.env.unlockTitle'),
                      description: t('ws.env.unlockBody'),
                      confirmLabel: t('ws.env.unlockConfirm'),
                      tone: 'danger',
                    })
                    if (!ok) return
                  }
                  void act(() => setEnvironmentLock(!current.locked), current.locked ? t('ws.env.unlockedDone') : t('ws.env.lockedDone'), true)
                }}
              >
                {current.locked ? <Unlock aria-hidden /> : <Lock aria-hidden />}
                {current.locked ? t('ws.env.unlockButton') : t('ws.env.lockButton')}
              </Button>
              {info.next ? (
                <span className="text-xs text-muted-foreground">
                  {t(info.next.member ? 'ws.env.promotesTo' : 'ws.env.promotesToAsk', { env: envLabel(info.next.environment), name: info.next.name })}
                </span>
              ) : (
                <span className="text-xs text-muted-foreground">{t('ws.env.lastEnv')}</span>
              )}
            </div>
            {freeEnvs.length > 0 && info.linkable.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3 text-sm">
                <h3 className="sr-only">{t('ws.env.linkHeading')}</h3>
                <Label htmlFor={`${id}-link`} className="font-normal">
                  {t('ws.env.link')}
                </Label>
                <select id={`${id}-link`} className={nativeSelectClass} value={linkId} onChange={(e) => setLinkId(e.target.value)} aria-label={t('ws.env.linkWorkspace')}>
                  <option value="">{t('ws.env.linkPlaceholder')}</option>
                  {info.linkable.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
                <span aria-hidden>{t('ws.env.as')}</span>
                <select className={nativeSelectClass} value={freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0]} onChange={(e) => setLinkEnv(e.target.value as Environment)} aria-label={t('ws.env.itsEnv')}>
                  {freeEnvs.map((e) => (
                    <option key={e} value={e}>
                      {envLabel(e)}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy || !linkId}
                  onClick={() => void act(() => linkEnvironment({ workspaceId: linkId, environment: freeEnvs.includes(linkEnv) ? linkEnv : freeEnvs[0] }), t('ws.env.linkedDone'))}
                >
                  {t('ws.env.link')}
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
