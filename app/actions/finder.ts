'use server'

import { asc, eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { businessRules, dashboards, dataSources, nexusDatasets, pipelines } from '@/lib/db/schema'
import { requireWorkspace } from '@/lib/auth/session'
import { canSeeDashboard, parseSharing } from '@/lib/analytics/sharing'
import { isSecretManager } from '@/lib/secrets/types'
import { guard } from '@/lib/server-action'

const LIMIT = 300

/**
 * Names of the workspace's records for "Go to" (Ctrl K): pipelines, data sources,
 * datasets, dashboards (only those shared with the caller) and business rules.
 * Names and ids only; no data, so nothing to audit.
 */
async function listFinderRecordsImpl() {
  const ctx = await requireWorkspace()
  const [pipes, sources, datasets, dashes, rules] = await Promise.all([
    db.select({ id: pipelines.id, name: pipelines.name }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId)).orderBy(asc(pipelines.name)).limit(LIMIT),
    db.select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType }).from(dataSources).where(eq(dataSources.workspaceId, ctx.workspaceId)).orderBy(asc(dataSources.name)).limit(LIMIT),
    db.select({ name: nexusDatasets.name }).from(nexusDatasets).where(eq(nexusDatasets.workspaceId, ctx.workspaceId)).orderBy(asc(nexusDatasets.name)).limit(LIMIT),
    db.select({ id: dashboards.id, name: dashboards.name, sharing: dashboards.sharing, createdBy: dashboards.createdBy }).from(dashboards).where(eq(dashboards.workspaceId, ctx.workspaceId)).orderBy(asc(dashboards.name)).limit(LIMIT),
    db.select({ id: businessRules.id, name: businessRules.name }).from(businessRules).where(eq(businessRules.workspaceId, ctx.workspaceId)).orderBy(asc(businessRules.name)).limit(LIMIT),
  ])
  return {
    pipelines: pipes,
    sources: sources.map((s) => ({ id: s.id, name: s.name, sourceType: s.sourceType, secrets: isSecretManager(s.sourceType) })),
    datasets: datasets.map((d) => d.name),
    dashboards: dashes.filter((d) => canSeeDashboard(parseSharing(d.sharing), ctx, d.createdBy)).map((d) => ({ id: d.id, name: d.name })),
    rules,
  }
}

export async function listFinderRecords(...args: Parameters<typeof listFinderRecordsImpl>) {
  return guard(() => listFinderRecordsImpl(...args))
}
