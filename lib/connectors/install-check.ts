import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { connectorInstalls } from '@/lib/db/schema'
import { requireWorkspace } from '@/lib/auth/session'

const slugSchema = z.string().trim().min(1).max(60)

/** Throws unless the active workspace has installed the connector. Server-only; used by data-source actions. */
export async function assertConnectorInstalled(rawSlug: string) {
  const ctx = await requireWorkspace()
  const slug = slugSchema.parse(rawSlug)
  const [install] = await db
    .select()
    .from(connectorInstalls)
    .where(and(eq(connectorInstalls.workspaceId, ctx.workspaceId), eq(connectorInstalls.connectorSlug, slug)))
    .limit(1)
  if (!install?.purchased || !install.installedAt) {
    throw new Error(`Connector "${slug}" is not installed. A workspace admin can install it from the Connector Marketplace.`)
  }
}
