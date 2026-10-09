'use server'

import { z } from 'zod'
import { and, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { auditLogs, connectorInstalls, dataSources } from '@/lib/db/schema'
import { CONNECTOR_CATALOG, getConnectorDefinition } from '@/lib/connectors/catalog'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'

/**
 * While billing is off (development), every connector — premium included —
 * installs for free. Set CONNECTOR_BILLING_ENABLED=true to require purchase.
 */
function billingEnabled() {
  return process.env.CONNECTOR_BILLING_ENABLED === 'true'
}

const slugSchema = z.string().trim().min(1).max(60)

async function getWorkspaceInstalls(workspaceId: string) {
  return db.select().from(connectorInstalls).where(eq(connectorInstalls.workspaceId, workspaceId))
}

async function audit(ctx: WorkspaceContext, action: string, slug: string) {
  await db.insert(auditLogs).values({ id: newId('audit'), userId: ctx.userId, workspaceId: ctx.workspaceId, action, resource: 'connector', resourceId: slug })
}

export async function getConnectorMarketplace() {
  const ctx = await requireWorkspace()
  const installs = await getWorkspaceInstalls(ctx.workspaceId)
  const installMap = new Map(installs.map((i) => [i.connectorSlug, i]))
  const billing = billingEnabled()

  return CONNECTOR_CATALOG.map((connector) => {
    const install = installMap.get(connector.slug)
    const purchased = Boolean(install?.purchased)
    const installed = Boolean(install?.installedAt) && purchased
    return {
      ...connector,
      purchased,
      installed,
      billing,
      locked: billing && connector.premium && !purchased,
    }
  })
}

export async function getInstalledConnectorSlugs() {
  const marketplace = await getConnectorMarketplace()
  return marketplace.filter((c) => c.installed).map((c) => c.slug)
}

/** Installs a connector (and records the purchase when billing is on). */
export async function installConnector(rawSlug: string) {
  const ctx = await requireWorkspace('connectors:manage')
  const slug = slugSchema.parse(rawSlug)
  const definition = getConnectorDefinition(slug)
  if (!definition) throw new Error('Connector not found')

  const now = new Date()
  const [existing] = await db
    .select()
    .from(connectorInstalls)
    .where(and(eq(connectorInstalls.workspaceId, ctx.workspaceId), eq(connectorInstalls.connectorSlug, slug)))
    .limit(1)
  if (existing) {
    await db.update(connectorInstalls).set({ purchased: true, installedAt: now, updatedAt: now }).where(eq(connectorInstalls.id, existing.id))
  } else {
    await db.insert(connectorInstalls).values({ id: newId('ci'), userId: ctx.userId, workspaceId: ctx.workspaceId, connectorSlug: slug, purchased: true, installedAt: now })
  }
  await audit(ctx, billingEnabled() && definition.premium ? 'PURCHASE' : 'INSTALL', slug)
  revalidatePath('/dashboard')
  return { ok: true as const, slug }
}

/** @deprecated kept for older callers; use installConnector. */
export async function purchaseConnector(slug: string) {
  return installConnector(slug)
}

export async function uninstallConnector(rawSlug: string) {
  const ctx = await requireWorkspace('connectors:manage')
  const slug = slugSchema.parse(rawSlug)
  const inUse = await db
    .select({ name: dataSources.name })
    .from(dataSources)
    .where(and(eq(dataSources.workspaceId, ctx.workspaceId), eq(dataSources.sourceType, slug)))
  if (inUse.length) {
    throw new Error(`Still used by ${inUse.map((s) => `"${s.name}"`).join(', ')}. Delete those data sources first.`)
  }
  await db
    .update(connectorInstalls)
    .set({ installedAt: null, updatedAt: new Date() })
    .where(and(eq(connectorInstalls.workspaceId, ctx.workspaceId), eq(connectorInstalls.connectorSlug, slug)))
  await audit(ctx, 'UNINSTALL', slug)
  revalidatePath('/dashboard')
}

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
