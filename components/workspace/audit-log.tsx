'use client'

import { useCallback, useEffect, useState } from 'react'
import { History, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { listAuditLogs } from '@/app/actions/audit'

type Row = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'RENAME', 'RUN', 'TEST_RUN', 'VIEW_DATA', 'ENABLE', 'DISABLE', 'RESET_SYNC',
  'INSTALL', 'UNINSTALL', 'UPDATE_CREDENTIALS', 'INVITE', 'REVOKE_INVITE', 'ACCEPT_INVITE', 'CHANGE_ROLE', 'REMOVE_MEMBER', 'LEAVE',
]

const stamp = (d: Date | string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(d))

function summary(changes: unknown) {
  if (!changes || typeof changes !== 'object') return ''
  return Object.entries(changes as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

/** Workspace audit trail (roles with audit:view). */
export function AuditLog() {
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
    [action]
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <section className="rounded-xl border border-border bg-card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <History className="h-4 w-4 text-primary" />
        <h3 className="font-semibold">Audit log</h3>
        <div className="ml-auto flex items-center gap-2">
          <select className="h-8 rounded-md border border-input bg-background px-2 text-sm" value={action} onChange={(e) => setAction(e.target.value)} aria-label="Filter by action">
            <option value="">All actions</option>
            {ACTIONS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading} aria-label="Refresh audit log">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
      <p className="mb-3 text-xs text-muted-foreground">
        Every change, data view (previews, samples, rejected rows, test runs) and pipeline run in this workspace, with who did it and from where. Credential values are never recorded.
      </p>
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
              <th className="px-2 py-2">When (WIB)</th>
              <th className="px-2 py-2">Who</th>
              <th className="px-2 py-2">Action</th>
              <th className="px-2 py-2">Resource</th>
              <th className="px-2 py-2">Details</th>
              <th className="px-2 py-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border/60 align-top">
                <td className="whitespace-nowrap px-2 py-2 text-muted-foreground">{stamp(r.createdAt)}</td>
                <td className="px-2 py-2">{r.email ?? 'deleted user'}</td>
                <td className="px-2 py-2 font-mono text-xs">{r.action}</td>
                <td className="px-2 py-2">
                  {r.resource}
                  {r.resourceId && <div className="max-w-[180px] truncate font-mono text-xs text-muted-foreground" title={r.resourceId}>{r.resourceId}</div>}
                </td>
                <td className="max-w-[320px] px-2 py-2 text-xs text-muted-foreground">
                  <span className="line-clamp-2" title={summary(r.changes)}>{summary(r.changes)}</span>
                </td>
                <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-muted-foreground" title={r.userAgent ?? ''}>{r.ipAddress ?? '-'}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-6 text-center text-muted-foreground">No audit events{action ? ` for ${action}` : ''} yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {loading && rows.length === 0 && <Loader2 className="mx-auto mt-4 h-5 w-5 animate-spin text-muted-foreground" />}
      {hasMore && (
        <Button size="sm" variant="outline" className="mt-3" disabled={loading} onClick={() => void load(rows)}>
          Load older
        </Button>
      )}
    </section>
  )
}
