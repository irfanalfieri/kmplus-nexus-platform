'use client'

import { useCallback, useEffect, useId, useState } from 'react'
import { History, Loader2, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Notice } from '@/components/ui/notice'
import { EmptyState } from '@/components/ui/empty-state'
import { Table, TBody, Td, Th, THead, Tr } from '@/components/ui/data-table'
import { SettingsPanel, nativeSelectClass } from '@/components/workspace/settings-panel'
import { listAuditLogs } from '@/lib/actions/audit'
import { describeDiff } from '@/lib/audit-diff'

type Row = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'RENAME', 'RUN', 'TEST_RUN', 'VIEW_DATA', 'ENABLE', 'DISABLE', 'RESET_SYNC',
  'INSTALL', 'UNINSTALL', 'UPDATE_CREDENTIALS', 'INVITE', 'REVOKE_INVITE', 'ACCEPT_INVITE', 'CHANGE_ROLE', 'REMOVE_MEMBER', 'LEAVE',
  'PUBLISH', 'REQUEST_APPROVAL', 'APPROVE', 'REJECT', 'PROMOTE', 'UPDATE_POLICY', 'PROVISION', 'DEPROVISION', 'LOGIN',
]

const stamp = (d: Date | string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(d))

/** Before/after values recorded with the event (changes.diff). */
const diffLines = (changes: unknown) => describeDiff((changes as { diff?: Record<string, unknown> } | null)?.diff)

function summary(changes: unknown) {
  if (!changes || typeof changes !== 'object') return ''
  return Object.entries(changes as Record<string, unknown>)
    .filter(([k]) => k !== 'diff')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** Workspace audit trail (roles with audit:view). */
export function AuditLog() {
  const filterId = useId()
  const [rows, setRows] = useState<Row[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [action, setAction] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(
    async (append: Row[] = []) => {
      setLoading(true)
      setError('')
      try {
        const last = append.at(-1)
        const res = await listAuditLogs({ action: action || undefined, before: last ? new Date(last.createdAt).toISOString() : undefined })
        setRows([...append, ...res.rows])
        setHasMore(res.hasMore)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load the audit log')
      } finally {
        setLoading(false)
      }
    },
    [action],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SettingsPanel
      title="Audit log"
      description="Every change, data view (previews, samples, rejected rows, test runs) and pipeline run in this workspace, with who did it and from where. Credential values are never recorded."
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Label htmlFor={filterId}>Action</Label>
        <select id={filterId} className={nativeSelectClass} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">All actions</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <Button size="icon" variant="outline" onClick={() => void load()} disabled={loading} aria-label="Refresh audit log">
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden />
        </Button>
      </div>
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
      <div className="-mx-5 border-y border-border">
        <Table label="Audit log" className="min-w-[760px]" aria-busy={loading || undefined}>
          <THead>
            <tr>
              <Th className="pl-5">When (WIB)</Th>
              <Th>Who</Th>
              <Th>Action</Th>
              <Th>Resource</Th>
              <Th>Details</Th>
              <Th className="pr-5">IP</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const diff = diffLines(r.changes)
              return (
                <Tr key={r.id} className="align-top">
                  <Td className="pl-5 align-top font-mono text-xs whitespace-nowrap text-muted-foreground">{stamp(r.createdAt)}</Td>
                  <Td className="align-top">{r.email ?? 'deleted user'}</Td>
                  <Td className="align-top font-mono text-xs">{r.action}</Td>
                  <Td className="align-top">
                    {r.resource}
                    {r.resourceId && (
                      <div className="max-w-[180px] truncate font-mono text-xs text-muted-foreground" title={r.resourceId}>
                        {r.resourceId}
                      </div>
                    )}
                  </Td>
                  <Td className="max-w-[320px] align-top text-xs text-muted-foreground">
                    <span className="line-clamp-2" title={summary(r.changes)}>
                      {summary(r.changes)}
                    </span>
                    {diff.length > 0 && (
                      <details className="mt-1">
                        <summary className="cursor-pointer text-info-text">
                          {diff.length} field change{diff.length === 1 ? '' : 's'}
                        </summary>
                        <ul className="mt-1 space-y-0.5 font-mono text-[11px]">
                          {diff.map((l, i) => (
                            <li key={i} className="break-all">
                              {l}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </Td>
                  <Td className="pr-5 align-top font-mono text-xs whitespace-nowrap text-muted-foreground" title={r.userAgent ?? ''}>
                    {r.ipAddress ?? '-'}
                  </Td>
                </Tr>
              )
            })}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6}>
                  <EmptyState compact icon={<History />} title={`No audit events${action ? ` for ${action}` : ''} yet.`} />
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" aria-hidden />
                  <span className="sr-only">Loading…</span>
                </td>
              </tr>
            )}
          </TBody>
        </Table>
      </div>
      {hasMore && (
        <Button size="sm" variant="outline" className="mt-3" disabled={loading} onClick={() => void load(rows)}>
          Load older
        </Button>
      )}
    </SettingsPanel>
  )
}
