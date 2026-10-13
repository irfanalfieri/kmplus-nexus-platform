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
import { usePrefs } from '@/components/i18n/i18n-provider'
import { en } from '@/lib/i18n/messages/en'

type Row = Awaited<ReturnType<typeof listAuditLogs>>['rows'][number]

const ACTIONS = [
  'CREATE', 'UPDATE', 'DELETE', 'RENAME', 'RUN', 'TEST_RUN', 'VIEW_DATA', 'ENABLE', 'DISABLE', 'RESET_SYNC',
  'INSTALL', 'UNINSTALL', 'UPDATE_CREDENTIALS', 'INVITE', 'REVOKE_INVITE', 'ACCEPT_INVITE', 'CHANGE_ROLE', 'REMOVE_MEMBER', 'LEAVE',
  'PUBLISH', 'REQUEST_APPROVAL', 'APPROVE', 'REJECT', 'PROMOTE', 'UPDATE_POLICY', 'PROVISION', 'DEPROVISION', 'LOGIN',
]

/** Short date and time (the column says WIB), in the interface language. */
const STAMP: Intl.DateTimeFormatOptions = { dateStyle: undefined, timeStyle: undefined, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }

type KnownAction = keyof typeof en.ws.audit.actions
const isKnownAction = (a: string): a is KnownAction => Object.prototype.hasOwnProperty.call(en.ws.audit.actions, a)

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
  const { t, formatDateTime } = usePrefs()
  /** Readable name of an action code; unknown codes stay as they are. */
  const actionLabel = (a: string) => (isKnownAction(a) ? t(`ws.audit.actions.${a}` as const) : a)
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
        setError(err instanceof Error ? err.message : t('ws.audit.loadFailed'))
      } finally {
        setLoading(false)
      }
    },
    [action, t],
  )

  useEffect(() => {
    void load()
  }, [load])

  return (
    <SettingsPanel
      title={t('ws.audit.title')}
      description={t('ws.audit.description')}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Label htmlFor={filterId}>{t('ws.audit.action')}</Label>
        <select id={filterId} className={nativeSelectClass} value={action} onChange={(e) => setAction(e.target.value)}>
          <option value="">{t('ws.audit.allActions')}</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>
              {actionLabel(a)}
            </option>
          ))}
        </select>
        <Button size="icon" variant="outline" onClick={() => void load()} disabled={loading} aria-label={t('ws.audit.refresh')}>
          <RefreshCw className={cn(loading && 'animate-spin')} aria-hidden />
        </Button>
      </div>
      {error && <Notice tone="danger" className="mb-3">{error}</Notice>}
      <div className="-mx-5 border-y border-border">
        <Table label={t('ws.audit.title')} className="min-w-[760px]" aria-busy={loading || undefined}>
          <THead>
            <tr>
              <Th className="pl-5">{t('ws.audit.colWhen')}</Th>
              <Th>{t('ws.audit.colWho')}</Th>
              <Th>{t('ws.audit.colAction')}</Th>
              <Th>{t('ws.audit.colResource')}</Th>
              <Th>{t('ws.audit.colDetails')}</Th>
              <Th className="pr-5">{t('ws.audit.colIp')}</Th>
            </tr>
          </THead>
          <TBody>
            {rows.map((r) => {
              const diff = diffLines(r.changes)
              return (
                <Tr key={r.id} className="align-top">
                  <Td className="pl-5 align-top font-mono text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(r.createdAt, STAMP)}</Td>
                  <Td className="align-top">{r.email ?? t('ws.audit.deletedUser')}</Td>
                  <Td className="align-top text-xs">
                    <span title={r.action}>{actionLabel(r.action)}</span>
                  </Td>
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
                          {t('ws.audit.fieldChanges', { count: diff.length })}
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
                  <EmptyState compact icon={<History />} title={action ? t('ws.audit.emptyFor', { action: actionLabel(action) }) : t('ws.audit.empty')} />
                </td>
              </tr>
            )}
            {loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-muted-foreground">
                  <Loader2 className="mx-auto size-5 animate-spin" aria-hidden />
                  <span className="sr-only">{t('common.loading')}</span>
                </td>
              </tr>
            )}
          </TBody>
        </Table>
      </div>
      {hasMore && (
        <Button size="sm" variant="outline" className="mt-3" disabled={loading} onClick={() => void load(rows)}>
          {t('ws.audit.loadOlder')}
        </Button>
      )}
    </SettingsPanel>
  )
}
