'use server'

import { z } from 'zod'
import { and, desc, eq, lt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { auditLogs, user } from '@/lib/db/schema'
import { requireWorkspace } from '@/lib/auth/session'
import { guard } from '@/lib/server-action'

const PAGE_SIZE = 50

const listInput = z.object({
  action: z.string().trim().max(40).optional(),
  /** ISO timestamp of the last row of the previous page. */
  before: z.string().datetime().optional(),
})

/** The workspace's audit trail, newest first, 50 per page. */
async function listAuditLogsImpl(input: z.input<typeof listInput> = {}) {
  const ctx = await requireWorkspace('audit:view')
  const { action, before } = listInput.parse(input)
  const rows = await db
    .select({
      id: auditLogs.id,
      action: auditLogs.action,
      resource: auditLogs.resource,
      resourceId: auditLogs.resourceId,
      changes: auditLogs.changes,
      ipAddress: auditLogs.ipAddress,
      userAgent: auditLogs.userAgent,
      createdAt: auditLogs.createdAt,
      email: user.email,
    })
    .from(auditLogs)
    .leftJoin(user, eq(user.id, auditLogs.userId))
    .where(
      and(
        eq(auditLogs.workspaceId, ctx.workspaceId),
        action ? eq(auditLogs.action, action) : undefined,
        before ? lt(auditLogs.createdAt, new Date(before)) : undefined
      )
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(PAGE_SIZE + 1)
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/audit.ts. ──

export async function listAuditLogs(...args: Parameters<typeof listAuditLogsImpl>) {
  return guard(() => listAuditLogsImpl(...args))
}
