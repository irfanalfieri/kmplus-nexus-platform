'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, LogOut, Save, Settings, Trash2, UserPlus, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  changeMemberRole,
  createInvite,
  listInvites,
  listMembers,
  removeMember,
  renameWorkspace,
  revokeInvite,
} from '@/app/actions/workspaces'
import { ROLE_INFO, ROLES, type Role } from '@/lib/auth/permissions'
import { useCan, useWorkspace } from '@/components/workspace/workspace-context'
import { AuditLog } from '@/components/workspace/audit-log'

type Member = Awaited<ReturnType<typeof listMembers>>[number]
type Invite = Awaited<ReturnType<typeof listInvites>>[number]

const selectClass = 'h-8 rounded-md border border-input bg-background px-2 text-sm'
const when = (d: Date | string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(d))

export default function WorkspaceSettingsLayer() {
  const { workspace, role } = useWorkspace()
  const isAdmin = useCan('workspace:manage')
  const canAudit = useCan('audit:view')
  const [members, setMembers] = useState<Member[]>([])
  const [invites, setInvites] = useState<Invite[]>([])
  const [name, setName] = useState(workspace.name)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<Role>('viewer')
  const [link, setLink] = useState<{ url: string; email: string; emailed: boolean } | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)

  const load = useCallback(async () => {
    try {
      const [m, i] = await Promise.all([listMembers(), isAdmin ? listInvites() : Promise.resolve([])])
      setMembers(m)
      setInvites(i)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load members')
    }
  }, [isAdmin])

  useEffect(() => {
    void load()
  }, [load])

  const act = async (key: string, action: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    setError('')
    setNotice('')
    try {
      await action()
      if (done) setNotice(done)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }

  const invite = () =>
    act('invite', async () => {
      const res = await createInvite(inviteEmail, inviteRole)
      setLink({ url: `${window.location.origin}${res.path}`, email: res.email, emailed: res.emailed })
      setCopied(false)
      setInviteEmail('')
    })

  const copy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link.url)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  const me = members.find((m) => m.isYou)

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-2 flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          <Badge variant="outline">Workspace</Badge>
        </div>
        <h2 className="text-2xl font-bold">Workspace & members</h2>
        <p className="mt-1 text-muted-foreground">
          Everything in a workspace (data sources, connectors, pipelines, datasets, runs) is shared by its members. Your role here: {ROLE_INFO[role].label}.
        </p>
      </div>

      {error && <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {notice && <p className="rounded-lg border border-green-600/30 bg-green-600/10 p-3 text-sm text-green-700 dark:text-green-400">{notice}</p>}

      <section className="rounded-xl border border-border bg-card p-5">
        <h3 className="mb-3 font-semibold">Workspace name</h3>
        <form
          className="flex max-w-lg gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void act('rename', () => renameWorkspace(name), 'Workspace renamed. Reload to see it in the sidebar.')
          }}
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} aria-label="Workspace name" />
          {isAdmin && (
            <Button type="submit" disabled={busy === 'rename' || !name.trim() || name === workspace.name}>
              <Save className="mr-1 h-4 w-4" /> Save
            </Button>
          )}
        </form>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center gap-2">
          <Users className="h-4 w-4 text-primary" />
          <h3 className="font-semibold">Members ({members.length})</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
                <th className="px-2 py-2">Member</th>
                <th className="px-2 py-2">Role</th>
                <th className="px-2 py-2">Joined</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.userId} className="border-b border-border/60">
                  <td className="px-2 py-2">
                    <div className="font-medium">
                      {m.name || m.email} {m.isYou && <span className="text-xs text-muted-foreground">(you)</span>}
                    </div>
                    <div className="text-xs text-muted-foreground">{m.email}</div>
                  </td>
                  <td className="px-2 py-2">
                    {isAdmin ? (
                      <select
                        className={selectClass}
                        value={m.role}
                        disabled={busy !== null}
                        onChange={(e) => void act(`role:${m.userId}`, () => changeMemberRole(m.userId, e.target.value), `${m.email} is now ${ROLE_INFO[e.target.value as Role].label}.`)}
                        aria-label={`Role of ${m.email}`}
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
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{when(m.joinedAt)}</td>
                  <td className="px-2 py-2 text-right">
                    {isAdmin && !m.isYou && (
                      <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`remove:${m.userId}`, () => removeMember(m.userId), `${m.email} removed.`)} aria-label={`Remove ${m.email}`}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">What can each role do?</summary>
          <ul className="mt-2 space-y-1">
            {ROLES.map((r) => (
              <li key={r}>
                <span className="font-medium">{ROLE_INFO[r].label}:</span> <span className="text-muted-foreground">{ROLE_INFO[r].description}</span>
              </li>
            ))}
          </ul>
        </details>
      </section>

      {isAdmin && (
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <h3 className="font-semibold">Invite someone</h3>
          </div>
          <form
            className="flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void invite()
            }}
          >
            <Input type="email" required value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="colleague@company.co.id" className="max-w-xs" aria-label="Email to invite" />
            <select className={`${selectClass} h-9`} value={inviteRole} onChange={(e) => setInviteRole(e.target.value as Role)} aria-label="Role for the invite">
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_INFO[r].label}
                </option>
              ))}
            </select>
            <Button type="submit" disabled={busy === 'invite'}>
              {busy === 'invite' ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Link2 className="mr-1 h-4 w-4" />}
              Create invite link
            </Button>
          </form>
          <p className="mt-2 text-xs text-muted-foreground">
            Nexus emails the invite link when email is set up; you can also copy it. It works once, for that email address only, and expires in 7 days.
          </p>
          {link && (
            <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
              <div className="mb-1">
                {link.emailed ? 'Emailed to' : 'Email not sent; send this link to'} <span className="font-medium">{link.email}</span> (shown only once):
              </div>
              <div className="flex gap-2">
                <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} aria-label="Invite link" />
                <Button type="button" variant="outline" onClick={() => void copy()}>
                  {copied ? <Check className="mr-1 h-4 w-4" /> : <Copy className="mr-1 h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>
          )}

          {invites.length > 0 && (
            <div className="mt-4">
              <div className="mb-2 text-sm font-medium">Pending invites</div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {invites.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1 truncate">{i.email}</span>
                    <span className="text-muted-foreground">{ROLE_INFO[i.role as Role]?.label ?? i.role}</span>
                    <span className="text-xs text-muted-foreground">expires {when(i.expiresAt)}</span>
                    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`revoke:${i.id}`, () => revokeInvite(i.id), 'Invite revoked.')}>
                      Revoke
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {canAudit && <AuditLog />}

      {me && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-1 font-semibold">Leave workspace</h3>
          <p className="mb-3 text-sm text-muted-foreground">You lose access to everything in {workspace.name}. The last admin can&apos;t leave.</p>
          {confirmLeave ? (
            <div className="flex items-center gap-2 text-sm">
              Leave &ldquo;{workspace.name}&rdquo;?
              <Button
                size="sm"
                variant="destructive"
                disabled={busy !== null}
                onClick={() =>
                  void act('leave', async () => {
                    await removeMember(me.userId)
                    window.location.reload()
                  })
                }
              >
                Leave
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="outline" onClick={() => setConfirmLeave(true)}>
              <LogOut className="mr-1 h-4 w-4" /> Leave workspace
            </Button>
          )}
        </section>
      )}
    </div>
  )
}
