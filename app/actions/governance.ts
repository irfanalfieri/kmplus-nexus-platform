'use server'

import { createHash } from 'node:crypto'
import { z } from 'zod'
import { and, count, eq, gte } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db, pool } from '@/lib/db'
import { auditLogs, dataSources, datasetPolicies, nexusDatasets, user, workspaceMembers } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { currentKeyId } from '@/lib/security/credentials'
import { policyInputSchema, suggestColumnPolicy, type ColumnPolicy } from '@/lib/governance/definition'
import { applyMasks, masksFor } from '@/lib/governance/masking'
import { applyRetentionFor } from '@/lib/governance/retention'
import { readDatasetSample } from '@/lib/pipelines/io'
import { guard } from '@/lib/server-action'

const qIdent = (name: string) => `"${name.replace(/"/g, '""')}"`
const nameSchema = z.string().trim().min(1).max(63)

type DatasetColumn = { name: string; type: string }

/** Everything the Governance screen shows: control status and each dataset's policy. Column names only, no data. */
async function getGovernanceOverviewImpl() {
  const ctx = await requireWorkspace()
  const since = new Date(Date.now() - 7 * 86_400_000)
  const [members, sources, auditCount, datasets, policies] = await Promise.all([
    db
      .select({ twoFactorEnabled: user.twoFactorEnabled })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ctx.workspaceId)),
    db.select({ credentials: dataSources.credentials }).from(dataSources).where(eq(dataSources.workspaceId, ctx.workspaceId)),
    db.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.workspaceId, ctx.workspaceId), gte(auditLogs.createdAt, since))),
    db
      .select({ name: nexusDatasets.name, rowCount: nexusDatasets.rowCount, lastLoadedAt: nexusDatasets.lastLoadedAt, columns: nexusDatasets.columns })
      .from(nexusDatasets)
      .where(eq(nexusDatasets.workspaceId, ctx.workspaceId))
      .orderBy(nexusDatasets.name),
    db
      .select({
        datasetName: datasetPolicies.datasetName,
        columns: datasetPolicies.columns,
        retentionDays: datasetPolicies.retentionDays,
        retentionAppliedAt: datasetPolicies.retentionAppliedAt,
        updatedAt: datasetPolicies.updatedAt,
        updatedByEmail: user.email,
      })
      .from(datasetPolicies)
      .leftJoin(user, eq(user.id, datasetPolicies.updatedBy))
      .where(eq(datasetPolicies.workspaceId, ctx.workspaceId)),
  ])

  let keyId: string | null = null
  try {
    keyId = currentKeyId()
  } catch {
    keyId = null
  }
  const envelopes = sources.map((s) => s.credentials as { __enc?: string; kid?: string } | null)
  const byName = new Map(policies.map((p) => [p.datasetName, p]))
  const rows = datasets.map((d) => {
    const columns = (d.columns as DatasetColumn[]) ?? []
    const policy = byName.get(d.name)
    const saved = (policy?.columns ?? {}) as Record<string, ColumnPolicy>
    // Unsaved columns get a suggestion from their name; nothing is enforced until saved.
    const effective: Record<string, ColumnPolicy & { suggested?: boolean }> = {}
    for (const c of columns) effective[c.name] = saved[c.name] ?? { ...suggestColumnPolicy(c.name), suggested: true }
    return {
      name: d.name,
      rowCount: d.rowCount ?? 0,
      lastLoadedAt: d.lastLoadedAt,
      columns,
      policy: policy ? { retentionDays: policy.retentionDays, retentionAppliedAt: policy.retentionAppliedAt, updatedAt: policy.updatedAt, updatedByEmail: policy.updatedByEmail } : null,
      columnPolicies: effective,
    }
  })
  const savedColumns = policies.flatMap((p) => Object.values((p.columns ?? {}) as Record<string, ColumnPolicy>))

  return {
    role: ctx.role,
    canManage: can(ctx.role, 'governance:manage'),
    canErase: can(ctx.role, 'data:erase'),
    seesUnmasked: can(ctx.role, 'data:unmasked'),
    controls: {
      members: members.length,
      membersWith2fa: members.filter((m) => m.twoFactorEnabled).length,
      dataSources: sources.length,
      encryptedSources: envelopes.filter((e) => e?.__enc === 'v1').length,
      onCurrentKey: keyId ? envelopes.filter((e) => e?.kid === keyId).length : null,
      auditEvents7d: auditCount[0]?.n ?? 0,
      datasets: datasets.length,
      datasetsWithPolicy: policies.length,
      classifiedPersonal: savedColumns.filter((c) => c.classification === 'personal' || c.classification === 'sensitive').length,
      maskedColumns: savedColumns.filter((c) => c.mask !== 'none').length,
      retentionPolicies: policies.filter((p) => p.retentionDays != null).length,
    },
    datasets: rows,
  }
}

/** Saves a dataset's column classification, masking and retention, and enforces retention right away. */
async function saveDatasetPolicyImpl(input: z.input<typeof policyInputSchema>) {
  const ctx = await requireWorkspace('governance:manage')
  const data = policyInputSchema.parse(input)
  const [dataset] = await db
    .select({ columns: nexusDatasets.columns })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, data.datasetName)))
    .limit(1)
  if (!dataset) throw new Error('Dataset not found')
  const known = new Set(((dataset.columns as DatasetColumn[]) ?? []).map((c) => c.name))
  const columns = Object.fromEntries(Object.entries(data.columns).filter(([name]) => known.has(name)))
  const now = new Date()
  await db
    .insert(datasetPolicies)
    .values({ id: newId('pol'), workspaceId: ctx.workspaceId, datasetName: data.datasetName, columns, retentionDays: data.retentionDays, updatedBy: ctx.userId })
    .onConflictDoUpdate({
      target: [datasetPolicies.workspaceId, datasetPolicies.datasetName],
      set: { columns, retentionDays: data.retentionDays, retentionAppliedAt: null, updatedBy: ctx.userId, updatedAt: now },
    })
  const masked = Object.entries(columns).filter(([, p]) => p.mask !== 'none').map(([n, p]) => `${n}:${p.mask}`)
  let deleted = 0
  if (data.retentionDays != null) deleted = await applyRetentionFor(ctx.workspaceId, data.datasetName, data.retentionDays)
  await recordAudit(ctx, { action: 'UPDATE_POLICY', resource: 'dataset', resourceId: data.datasetName, changes: { masked, retentionDays: data.retentionDays, retentionDeleted: deleted } })
  revalidatePath('/dashboard')
  return { masked: masked.length, retentionDeleted: deleted }
}

/** First rows as a role without data:unmasked sees them, using the saved policy. */
async function previewMaskedDatasetImpl(rawName: string) {
  const ctx = await requireWorkspace('governance:manage')
  const name = nameSchema.parse(rawName)
  const [dataset] = await db
    .select({ id: nexusDatasets.id, tableName: nexusDatasets.tableName })
    .from(nexusDatasets)
    .where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, name)))
    .limit(1)
  if (!dataset) throw new Error('Dataset not found')
  const masks = await masksFor(ctx.workspaceId, name, 'viewer')
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dataset', resourceId: dataset.id, changes: { what: 'masked_preview', dataset: name } })
  return { rows: applyMasks(await readDatasetSample(dataset.tableName, 10), masks), masked: Object.keys(masks) }
}

// ── Right to erasure (UU PDP) ────────────────────────────────────────────────

const erasureInput = z.object({
  column: z.string().trim().min(1).max(128),
  value: z.string().trim().min(1, 'Enter the value to erase').max(500),
})

async function erasureTargets(workspaceId: string, column: string) {
  const datasets = await db
    .select({ id: nexusDatasets.id, name: nexusDatasets.name, tableName: nexusDatasets.tableName, columns: nexusDatasets.columns })
    .from(nexusDatasets)
    .where(eq(nexusDatasets.workspaceId, workspaceId))
  return datasets.filter((d) => ((d.columns as DatasetColumn[]) ?? []).some((c) => c.name === column))
}

/** Datasets holding a column, for the erasure form. */
async function listErasureColumnsImpl() {
  const ctx = await requireWorkspace('data:erase')
  const datasets = await db.select({ columns: nexusDatasets.columns }).from(nexusDatasets).where(eq(nexusDatasets.workspaceId, ctx.workspaceId))
  const counts = new Map<string, number>()
  for (const d of datasets) for (const c of (d.columns as DatasetColumn[]) ?? []) counts.set(c.name, (counts.get(c.name) ?? 0) + 1)
  return [...counts.entries()].map(([name, datasets]) => ({ name, datasets })).sort((a, b) => b.datasets - a.datasets || a.name.localeCompare(b.name))
}

/** How many rows match in each dataset (exact match on the column's text value). */
async function findErasureMatchesImpl(input: z.input<typeof erasureInput>) {
  const ctx = await requireWorkspace('data:erase')
  const { column, value } = erasureInput.parse(input)
  const results: { dataset: string; matches: number }[] = []
  for (const d of await erasureTargets(ctx.workspaceId, column)) {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM "nexus_data".${qIdent(d.tableName)} WHERE ${qIdent(column)}::text = $1`,
      [value]
    )
    results.push({ dataset: d.name, matches: rows[0].n })
  }
  return results
}

/**
 * Deletes every row whose column equals the value, in all datasets. The audit
 * entry stores a hash of the value, never the value itself (it is personal data).
 */
async function eraseRecordsImpl(input: z.input<typeof erasureInput>) {
  const ctx = await requireWorkspace('data:erase')
  const { column, value } = erasureInput.parse(input)
  const erased: { dataset: string; deleted: number }[] = []
  for (const d of await erasureTargets(ctx.workspaceId, column)) {
    const table = `"nexus_data".${qIdent(d.tableName)}`
    const res = await pool.query(`DELETE FROM ${table} WHERE ${qIdent(column)}::text = $1`, [value])
    const { rows } = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)
    await db.update(nexusDatasets).set({ rowCount: rows[0].n, updatedAt: new Date() }).where(eq(nexusDatasets.id, d.id))
    erased.push({ dataset: d.name, deleted: res.rowCount ?? 0 })
  }
  await recordAudit(ctx, {
    action: 'DELETE',
    resource: 'erasure',
    resourceId: column,
    changes: { column, valueSha256: createHash('sha256').update(value).digest('hex'), erased },
  })
  revalidatePath('/dashboard')
  return { erased, total: erased.reduce((s, e) => s + e.deleted, 0) }
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/governance.ts. ──

export async function getGovernanceOverview(...args: Parameters<typeof getGovernanceOverviewImpl>) {
  return guard(() => getGovernanceOverviewImpl(...args))
}

export async function saveDatasetPolicy(...args: Parameters<typeof saveDatasetPolicyImpl>) {
  return guard(() => saveDatasetPolicyImpl(...args))
}

export async function previewMaskedDataset(...args: Parameters<typeof previewMaskedDatasetImpl>) {
  return guard(() => previewMaskedDatasetImpl(...args))
}

export async function listErasureColumns(...args: Parameters<typeof listErasureColumnsImpl>) {
  return guard(() => listErasureColumnsImpl(...args))
}

export async function findErasureMatches(...args: Parameters<typeof findErasureMatchesImpl>) {
  return guard(() => findErasureMatchesImpl(...args))
}

export async function eraseRecords(...args: Parameters<typeof eraseRecordsImpl>) {
  return guard(() => eraseRecordsImpl(...args))
}
