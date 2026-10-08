'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { connectorInstalls, auditLogs } from '@/lib/db/schema'
import { CONNECTOR_CATALOG, getConnectorDefinition } from '@/lib/connectors/catalog'
import { and, eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'

async function getUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

async function getUserInstalls(userId: string) {
  return db
    .select()
    .from(connectorInstalls)
    .where(eq(connectorInstalls.userId, userId))
}

export async function getConnectorMarketplace() {
  const userId = await getUserId()
  const installs = await getUserInstalls(userId)
  const installMap = new Map(installs.map((i) => [i.connectorSlug, i]))

  return CONNECTOR_CATALOG.map((connector) => {
    const install = installMap.get(connector.slug)
    const purchased = Boolean(install?.purchased)
    const installed = Boolean(install?.installedAt)

    return {
      ...connector,
      purchased,
      installed,
      locked: connector.premium && !purchased,
    }
  })
}

export async function getInstalledConnectorSlugs() {
  const marketplace = await getConnectorMarketplace()
  return marketplace.filter((c) => c.installed && c.purchased).map((c) => c.slug)
}

export async function purchaseConnector(slug: string) {
  const userId = await getUserId()
  const definition = getConnectorDefinition(slug)
  if (!definition) throw new Error('Connector not found')

  const [existing] = await db
    .select()
    .from(connectorInstalls)
    .where(and(eq(connectorInstalls.userId, userId), eq(connectorInstalls.connectorSlug, slug)))
    .limit(1)

  const now = new Date()

  if (existing) {
    await db
      .update(connectorInstalls)
      .set({ purchased: true, installedAt: now, updatedAt: now })
      .where(eq(connectorInstalls.id, existing.id))
  } else {
    await db.insert(connectorInstalls).values({
      id: `ci_${slug}_${Date.now()}`,
      userId,
      connectorSlug: slug,
      purchased: true,
      installedAt: now,
      createdAt: now,
      updatedAt: now,
    })
  }

  await db.insert(auditLogs).values({
    id: `audit_${Date.now()}`,
    userId,
    action: 'PURCHASE',
    resource: 'connector',
    resourceId: slug,
  })

  revalidatePath('/dashboard')
  return { ok: true as const, slug }
}

export async function assertConnectorInstalled(slug: string) {
  const userId = await getUserId()

  const [install] = await db
    .select()
    .from(connectorInstalls)
    .where(and(eq(connectorInstalls.userId, userId), eq(connectorInstalls.connectorSlug, slug)))
    .limit(1)

  if (!install?.purchased || !install.installedAt) {
    throw new Error(`Connector "${slug}" is not installed. Purchase it from the Connector Marketplace first.`)
  }
}
