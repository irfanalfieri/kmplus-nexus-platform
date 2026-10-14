'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Check, Copy, Link2, Loader2, LogOut, RotateCcw, Save, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Notice } from '@/components/ui/notice'
import { ConfirmDialog } from '@/components/ui/dialog'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { useToast } from '@/components/ui/toast'
import {
  changeMemberRole,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  resetMemberTwoFactor,
  renameWorkspace,
  revokeInvite,
} from '@/lib/actions/workspaces'
import { can, ROLE_INFO, ROLES, type Role } from '@/lib/auth/permissions'
import { SETTINGS_TABS, SETTINGS_TAB_PERMISSION, settingsHref, type SettingsTab } from '@/lib/navigation'
import { useCan, useWorkspace } from '@/components/workspace/workspace-context'
import { usePrefs } from '@/components/i18n/i18n-provider'
import { PageHeader } from '@/components/dashboard/page-header'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { AuditLog } from '@/components/workspace/audit-log'
import { AccountSecurity } from '@/components/workspace/account-security'
import { ApiKeys } from '@/components/workspace/api-keys'
import { SsoSettings } from '@/components/workspace/sso-settings'
import { Webhooks } from '@/components/workspace/webhooks'
import { EnvironmentsSettings } from '@/components/workspace/environments'
import { ScimSettings } from '@/components/workspace/scim-settings'
import { AgentsSettings } from '@/components/workspace/agents-settings'
import { AiSettings } from '@/components/workspace/ai-settings'

type Member = Awaited<ReturnType<typeof listMembers>>[number]
type Invite = Awaited<ReturnType<typeof listInvites>>[number]

export default function WorkspaceSettingsLayer({ tab }: { tab: SettingsTab }) {
  const { t } = usePrefs()
  const { role } = useWorkspace()
  const visible = SETTINGS_TABS.filter((s) => {
    const p = SETTINGS_TAB_PERMISSION[s]
    return !p || can(role, p)
  })
  const permission = SETTINGS_TAB_PERMISSION[tab]
  const allowed = !permission || can(role, permission)

  return (
    <div>
      <PageHeader title={t('pages.settings.title')} description={t('settings.intro', { role: ROLE_INFO[role].label })} />
      <div className="grid gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav data-tour="settings-tabs" aria-label={t('settings.sections')} className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
          <ul className="flex gap-1 lg:sticky lg:top-0 lg:flex-col">
            {visible.map((s) => (
              <li key={s} className="shrink-0">
                <Link
                  href={settingsHref(s)}
                  aria-current={s === tab ? 'page' : undefined}
                  className={cn(
                    'relative flex h-9 items-center rounded-sm px-3 text-sm whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
                    s === tab && 'bg-card font-medium text-foreground shadow-[inset_0_-2px_0_var(--live)] lg:shadow-[inset_3px_0_0_var(--live)]',
                  )}
                >
                  {t(`settings.${s}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0 space-y-5">
          {!allowed ? (
            <Notice tone="info">{t('settings.adminOnly')}</Notice>
          ) : tab === 'general' ? (
            <GeneralSettings />
          ) : tab === 'members' ? (
            <MembersSettings />
          ) : tab === 'account' ? (
            <AccountSecurity />
          ) : tab === 'access' ? (
            <>
              <SsoSettings />
              <ScimSettings />
            </>
          ) : tab === 'environments' ? (
            <EnvironmentsSettings />
          ) : tab === 'agents' ? (
            <AgentsSettings />
          ) : tab === 'ai' ? (
            <AiSettings />
          ) : tab === 'api' ? (
            <ApiKeys />
          ) : tab === 'webhooks' ? (
            <Webhooks />
          ) : (
            <AuditLog />
          )}
        </div>
      </div>
    </div>
  )
}


function useAct(reload?: () => Promise<void>) {
  const toast = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const act = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    setError('')
    try {
      await action()
      if (done) toast({ message: done })
      await reload?.()
      return true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      return false
    } finally {
      setBusy(null)
    }
  }
  return { busy, error, act }
}

function GeneralSettings() {
  const { t } = usePrefs()
  const { workspace, user } = useWorkspace()
  const isAdmin = useCan('workspace:manage')
  const [name, setName] = useState(workspace.name)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const { busy, error, act } = useAct()

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}
      <SettingsPanel title={t('settings.workspaceName')}>
        <form
          className="flex max-w-lg gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void act('rename', () => renameWorkspace(name), t('settings.renamed')).then((ok) => ok && window.location.reload())
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} aria-label={t('settings.workspaceName')} />
          {isAdmin && (
            <Button type="submit" disabled={busy === 'rename' || !name.trim() || name === workspace.name}>
              {busy === 'rename' ? <Loader2 className="animate-spin" /> : <Save />} {t('common.save')}
            </Button>
          )}
        </form>
      </SettingsPanel>

      <SettingsPanel title={t('settings.leaveTitle')} description={t('settings.leaveBody', { workspace: workspace.name })}>
        <Button variant="outline" onClick={() => setConfirmLeave(true)}>
          <LogOut /> {t('settings.leave')}
        </Button>
      </SettingsPanel>
      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title={t('settings.leaveConfirm', { workspace: workspace.name })}
        description={t('settings.leaveBody', { workspace: workspace.name })}
        confirmLabel={t('settings.leave')}
        tone="danger"
        busy={busy === 'leave'}
        onConfirm={() =>
          void act('leave', async () => {
            await removeMember(user.id)
            window.location.href = '/dashboard'
          })
        }
      />
    </>
  )
}

function MembersSettings() {
  const { t, formatDateTime } = usePrefs()
  const { workspace } = useWorkspace()
  const isAdmin = useCan('workspace:manage')
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('viewer')
  const [link, setLink] = useState<{ url: string; email: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirm, setConfirm] = useState<{ kind: 'reset' | 'remove'; member: Member } | null>(null)

  const load = useCallback(async () => {
    const [m, i] = await Promise.all([listMembers(), isAdmin ? listInvites() : Promise.resolve([])])
    setMembers(m)
    setInvites(i)
  }, [isAdmin])
  const { busy, error, act } = useAct(load)

  useEffect(() => {
    load().catch(() => setMembers([]))
  }, [load])

  const date = (d: Date | string) => formatDateTime(d, { dateStyle: 'medium', timeStyle: undefined })

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}
      <SettingsPanel title={members ? `${t('settings.membersTitle')} (${members.length})` : t('settings.membersTitle')}>
        {!members ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden /> {t('common.loading')}
          </p>
        ) : (
          <div className="-mx-5 border-y border-border">
            <Table label={t('settings.membersTitle')} className="min-w-[640px]">
              <THead>
                <tr>
                  <Th className="pl-5">{t('settings.colMember')}</Th>
                  <Th>{t('settings.colRole')}</Th>
                  <Th>{t('settings.colTwoFactor')}</Th>
                  <Th>{t('settings.colJoined')}</Th>
                  <Th className="pr-5">
                    <span className="sr-only">{t('common.edit')}</span>
                  </Th>
                </tr>
              </THead>
              <TBody>
                {members.map((m) => (
                  <Tr key={m.userId}>
                    <Td className="pl-5">
                      <div className="font-medium">
                        {m.name || m.email} {m.isYou && <span className="text-xs font-normal text-muted-foreground">({t('settings.you')})</span>}
                      </div>
                      <div className="text-xs text-muted-foreground">{m.email}</div>
                    </Td>
                    <Td>
                      {isAdmin ? (
                        <select
                          className={nativeSelectClass}
                          value={m.role}
                          disabled={busy !== null}
                          onChange={(e) => {
                            const next = e.target.value as Role
                            void act(`role:${m.userId}`, () => changeMemberRole(m.userId, next), t('settings.roleChanged', { email: m.email, role: ROLE_INFO[next].label }))
                          }}
                          aria-label={t('settings.roleOf', { email: m.email })}
                        >
                          {ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_INFO[r].label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        ROLE_INFO[m.role].label
                      )}
                    </Td>
                    <Td>
                      {m.twoFactorEnabled ? (
                        <span className="inline-flex items-center gap-1.5 text-live-text">
                          <ShieldCheck className="size-4" aria-hidden /> {t('settings.twoFactorOn')}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-warning-text">
                          <ShieldAlert className="size-4" aria-hidden /> {t('settings.twoFactorPending')}
                        </span>
                      )}
                    </Td>
                    <Td className="font-mono text-xs text-muted-foreground">{date(m.joinedAt)}</Td>
                    <Td className="pr-5 text-right">
                      {isAdmin && !m.isYou && (
                        <span className="inline-flex gap-1">
                          {m.twoFactorEnabled && (
                            <Button size="icon-sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirm({ kind: 'reset', member: m })} aria-label={t('settings.resetTwoFactor', { email: m.email })} title={t('settings.reset')}>
                              <RotateCcw />
                            </Button>
                          )}
                          <Button size="icon-sm" variant="ghost" disabled={busy !== null} onClick={() => setConfirm({ kind: 'remove', member: m })} aria-label={t('settings.removeMember', { email: m.email })}>
                            <Trash2 />
                          </Button>
                        </span>
                      )}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </div>
        )}
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer text-info-text">{t('settings.rolesHelp')}</summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
            {ROLES.map((r) => (
              <div key={r} className="contents">
                <dt className="font-medium">{ROLE_INFO[r].label}</dt>
                <dd className="text-muted-foreground">{ROLE_INFO[r].description}</dd>
              </div>
            ))}
          </dl>
        </details>
      </SettingsPanel>

      {isAdmin && (
        <SettingsPanel title={t('settings.inviteTitle')} description={t('settings.inviteHelp')}>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void act('invite', async () => {
                const res = await createInvite(inviteEmail, inviteRole)
                setLink({ url: `${window.location.origin}${res.path}`, email: res.email, emailed: res.emailed })
                setCopied(false)
                setInviteEmail('')
              })
            }}
          >
            <Input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.co.id" className="max-w-xs" aria-label={t('settings.inviteEmail')} />
            <select className={nativeSelectClass} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label={t('settings.inviteRole')}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_INFO[r].label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={busy === 'invite'}>
              {busy === 'invite' ? <Loader2 className="animate-spin" /> : <Link2 />}
              {t('settings.createInvite')}
            </Button>
          </form>
          {link && (
            <div className="mt-4 rounded-md border border-live/40 bg-live-soft p-3 text-sm" role="status">
              <p className="mb-2">{link.emailed ? t('settings.emailedTo', { email: link.email }) : t('settings.notEmailed', { email: link.email })}</p>
              <div className="flex gap-2">
                <Input readOnly value={link.url} className="bg-card font-mono text-xs" onFocus={(e) => e.target.select()} aria-label={t('settings.inviteLink')} />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    navigator.clipboard.writeText(link.url).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  {copied ? <Check /> : <Copy />}
                  {copied ? t('settings.copied') : t('settings.copy')}
                </Button>
              </div>
            </div>
          )}

          {invites.length > 0 && (
            <div className="mt-5">
              <h3 className="mb-2 text-sm font-medium">{t('settings.pendingInvites')}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <span className="text-muted-foreground">{ROLE_INFO[i.role as Role]?.label ?? i.role}</span>
                    <span className="font-mono text-xs text-muted-foreground">{t('settings.expires', { date: date(i.expiresAt) })}</span>
                    <Button size="sm" variant="ghost" disabled={busy !== null} aria-label={t('settings.revokeLabel', { email: i.email })} onClick={() => void act(`revoke:${i.id}`, () => revokeInvite(i.id), t('settings.revoked'))}>
                      {t('settings.revoke')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </SettingsPanel>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={
          confirm?.kind === 'reset'
            ? t('settings.resetTitle', { email: confirm.member.email })
            : t('settings.removeTitle', { email: confirm?.member.email ?? '', workspace: workspace.name })
        }
        description={confirm?.kind === 'reset' ? t('settings.resetBody') : t('settings.removeBody')}
        confirmLabel={confirm?.kind === 'reset' ? t('settings.reset') : t('settings.remove')}
        tone="danger"
        busy={busy !== null}
        onConfirm={async () => {
          if (!confirm) return
          const { kind, member } = confirm
          const ok =
            kind === 'reset'
              ? await act(`reset:${member.userId}`, () => resetMemberTwoFactor(member.userId), t('settings.resetDone', { email: member.email }))
              : await act(`remove:${member.userId}`, () => removeMember(member.userId), t('settings.removed', { email: member.email }))
          if (ok) setConfirm(null)
        }}
      />
    </>
  )
}
