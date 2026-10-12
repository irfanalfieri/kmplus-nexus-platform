import { headers } from 'next/headers'
import { db } from '@/lib/db'
import { auditLogs } from '@/lib/db/schema'
import { newId } from '@/lib/auth/session'

/**
 * Audit trail (TD-15). Every mutation, every view of real data (dataset
 * previews, source samples, rejected rows, test runs) and every login is
 * recorded with the actor, workspace, client IP and user agent.
 * Never put secrets in `changes` (record field names, not values).
 */

export type AuditAction =
  | 'CREATE' | 'UPDATE' | 'DELETE' | 'RENAME'
  | 'RUN' | 'ENABLE' | 'DISABLE' | 'RESET_SYNC'
  | 'INSTALL' | 'PURCHASE' | 'UNINSTALL'
  | 'UPDATE_CREDENTIALS'
  | 'CHANGE_ROLE' | 'REMOVE_MEMBER' | 'LEAVE' | 'INVITE' | 'REVOKE_INVITE' | 'ACCEPT_INVITE'
  | 'VIEW_DATA' | 'TEST_RUN'
  | 'LOGIN' | 'ENABLE_2FA' | 'DISABLE_2FA' | 'REGENERATE_BACKUP_CODES' | 'RESET_2FA'
  | 'CANCEL' | 'RETRY'
  | 'UPDATE_POLICY' | 'PUBLISH' | 'REPLAY' | 'APPROVE' | 'DISMISS' | 'UPLOAD' | 'REVOKE' | 'API_READ'
  | 'REQUEST_APPROVAL' | 'REJECT' | 'PROMOTE' | 'PROVISION' | 'DEPROVISION' | 'AI_ASSIST'

export interface AuditEntry {
  action: AuditAction
  resource: string
  resourceId?: string | null
  changes?: Record<string, unknown>
  /** Before/after values of changed fields (lib/audit-diff.ts); stored as changes.diff. */
  diff?: Record<string, unknown>
}

/** Client IP and user agent of the current request, if there is one. */
export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  try {
    const h = await headers()
    const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim()
    return {
      ipAddress: forwarded || h.get('x-real-ip') || null,
      userAgent: h.get('user-agent')?.slice(0, 300) ?? null,
    }
  } catch {
    // Outside a request (e.g. scripts).
    return { ipAddress: null, userAgent: null }
  }
}

export async function recordAudit(actor: { userId: string; workspaceId: string | null }, entry: AuditEntry) {
  const meta = await requestMeta()
  await db.insert(auditLogs).values({
    id: newId('audit'),
    userId: actor.userId,
    workspaceId: actor.workspaceId,
    action: entry.action,
    resource: entry.resource,
    resourceId: entry.resourceId ?? null,
    changes: entry.diff && Object.keys(entry.diff).length ? { ...(entry.changes ?? {}), diff: entry.diff } : entry.changes,
    ...meta,
  })
}
