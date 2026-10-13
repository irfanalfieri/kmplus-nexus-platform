'use server'

import { z } from 'zod'
import { and, eq, gte, inArray, sql } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { catalogEntries, dashboards, dataSources, datasetQualitySnapshots, domainMappings, executionLogs, nexusDatasets, pipelines, user, workspaceMembers } from '@/lib/db/schema'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { can } from '@/lib/auth/permissions'
import { recordAudit } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { catalogInputSchema, datasetKey, parseKey, sourceKey } from '@/lib/catalog/definition'
import { definitionSchema, scheduleSchema } from '@/lib/pipelines/definition'
import { buildLineage, type LineageGraph } from '@/lib/catalog/lineage'
import { jakartaDay } from '@/lib/quality/snapshot'
import { liveQuery, readDatasetSample, type StoredDataSource } from '@/lib/pipelines/io'
import { pauseManagedPipeline, upsertCachePipeline } from '@/lib/pipelines/managed'
import { enqueueRun } from '@/lib/pipelines/jobs'
import { startWorker } from '@/lib/pipelines/worker'
import { accessFor, applyMasks, liveTableAccess } from '@/lib/governance/masking'
import { DOMAIN_BY_NAME } from '@/lib/domain/model'
import type { SchemaScanResult } from '@/lib/connectors/types'
import { guard } from '@/lib/server-action'
import { aiStatus, askModel } from '@/lib/ai/assistant'
import { catalogPrompt, checkCatalogAnswer, rankCatalog, type SearchHit, type SearchItem } from '@/lib/ai/discovery'

type Column = { name: string; type: string }
type Entry = typeof catalogEntries.$inferSelect

/** Pipelines (published definition) that write each dataset. */
function producers(rows: { id: string; name: string; config: unknown }[]) {
  const out = new Map<string, { id: string; name: string }[]>()
  for (const p of rows) {
    const def = definitionSchema.safeParse(p.config)
    if (!def.success) continue
    for (const n of def.data.nodes) if (n.type === 'destination' && n.kind === 'dataset') out.set(n.datasetName, [...(out.get(n.datasetName) ?? []), { id: p.id, name: p.name }])
  }
  return out
}

/**
 * Every dataset and source table of the workspace (DC-1), with its catalog
 * documentation, freshness (DV-4), producing pipelines and quality score.
 * Metadata only, no row contents.
 */
async function listCatalogImpl() {
  const ctx = await requireWorkspace()
  const since = new Date(Date.now() - 30 * 86_400_000)
  const [datasets, sources, entries, pipes, members, mappings, runs] = await Promise.all([
    db.select().from(nexusDatasets).where(eq(nexusDatasets.workspaceId, ctx.workspaceId)),
    db.select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, config: dataSources.config, lastConnected: dataSources.lastConnected }).from(dataSources).where(eq(dataSources.workspaceId, ctx.workspaceId)),
    db.select().from(catalogEntries).where(eq(catalogEntries.workspaceId, ctx.workspaceId)),
    db.select({ id: pipelines.id, name: pipelines.name, config: pipelines.config }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId)),
    db
      .select({ id: user.id, email: user.email, name: user.name })
      .from(workspaceMembers)
      .innerJoin(user, eq(user.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, ctx.workspaceId)),
    db.select().from(domainMappings).where(eq(domainMappings.workspaceId, ctx.workspaceId)),
    db
      .select({
        pipelineId: executionLogs.pipelineId,
        read: sql<number>`coalesce(sum(${executionLogs.recordsProcessed}), 0)::int`,
        bad: sql<number>`coalesce(sum(${executionLogs.recordsError}), 0)::int + coalesce(sum((${executionLogs.executionDetails}->>'flagged')::int), 0)::int`,
      })
      .from(executionLogs)
      .where(and(eq(executionLogs.workspaceId, ctx.workspaceId), gte(executionLogs.createdAt, since), inArray(executionLogs.status, ['success', 'partial', 'failed'])))
      .groupBy(executionLogs.pipelineId),
  ])
  const byKey = new Map(entries.map((e) => [e.key, e]))
  const memberName = (id: string | null) => (id ? members.find((m) => m.id === id)?.email ?? null : null)
  const made = producers(pipes)
  const score = (pipelineIds: string[]) => {
    const rs = runs.filter((r) => pipelineIds.includes(r.pipelineId))
    const read = rs.reduce((n, r) => n + r.read, 0)
    return read ? Math.max(0, Math.round(((read - rs.reduce((n, r) => n + r.bad, 0)) / read) * 1000) / 10) : null
  }
  const doc = (e: Entry | undefined) => ({
    description: e?.description ?? '',
    tags: (e?.tags as string[]) ?? [],
    classification: e?.classification ?? 'internal',
    ownerId: e?.ownerId ?? null,
    stewardId: e?.stewardId ?? null,
    owner: memberName(e?.ownerId ?? null),
    steward: memberName(e?.stewardId ?? null),
    updatedAt: e?.updatedAt ?? null,
  })
  const docsOf = (e: Entry | undefined) => (e?.columnDocs ?? {}) as Record<string, string>

  const items = [
    ...datasets.map((d) => {
      const e = byKey.get(datasetKey(d.name))
      const docs = docsOf(e)
      const by = made.get(d.name) ?? []
      const cachedFrom = entries.find((x) => x.kind === 'source_table' && x.accessMode === 'cached' && x.alias === d.name)
      return {
        key: datasetKey(d.name),
        kind: 'dataset' as const,
        name: d.name,
        sourceName: cachedFrom ? `${sources.find((s) => s.id === cachedFrom.dataSourceId)?.name ?? 'source'} · ${cachedFrom.tableName}` : null,
        columns: ((d.columns as Column[]) ?? []).map((c) => ({ ...c, doc: docs[c.name] ?? '' })),
        rowCount: d.rowCount ?? 0,
        lastLoadedAt: d.lastLoadedAt,
        producedBy: by,
        qualityScore: score(by.map((p) => p.id)),
        domains: mappings.filter((m) => m.datasetName === d.name).map((m) => m.entity),
        accessMode: 'cached' as const,
        alias: d.name,
        refresh: null,
        refreshAfterPipelineId: null,
        cachePipelineId: null,
        liveRowLimit: null,
        liveTimeoutSeconds: null,
        ...doc(e),
      }
    }),
    ...sources.flatMap((s) => {
      const scan = ((s.config ?? {}) as { schemaScan?: SchemaScanResult }).schemaScan
      return (scan?.tables ?? []).map((t) => {
        const key = sourceKey(s.id, t.name)
        const e = byKey.get(key)
        const docs = docsOf(e)
        const cached = e?.accessMode === 'cached' && e.alias ? datasets.find((d) => d.name === e.alias) : undefined
        return {
          key,
          kind: 'source_table' as const,
          name: t.schema && t.schema !== 'public' && t.schema !== 'file' ? `${t.schema}.${t.name}` : t.name,
          sourceName: s.name,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type, doc: docs[c.name] ?? '' })),
          rowCount: cached ? cached.rowCount ?? 0 : t.rowCount,
          // Live tables are as fresh as the source; cached ones as their last copy.
          lastLoadedAt: e?.accessMode === 'cached' ? cached?.lastLoadedAt ?? null : null,
          scannedAt: scan?.scannedAt ?? null,
          producedBy: [],
          qualityScore: e?.cachePipelineId ? score([e.cachePipelineId]) : null,
          domains: [],
          accessMode: (e?.accessMode ?? 'live') as 'live' | 'cached',
          alias: e?.alias ?? null,
          refresh: e?.refresh ?? 'daily',
          refreshAfterPipelineId: e?.refreshAfterPipelineId ?? null,
          cachePipelineId: e?.cachePipelineId ?? null,
          liveRowLimit: e?.liveRowLimit ?? 1000,
          liveTimeoutSeconds: e?.liveTimeoutSeconds ?? 30,
          ...doc(e),
        }
      })
    }),
  ]
  return {
    items,
    members: members.map((m) => ({ id: m.id, label: m.name ? `${m.name} (${m.email})` : m.email })),
    pipelines: pipes.map((p) => ({ id: p.id, name: p.name })),
    domainMappings: mappings.map((m) => ({ entity: m.entity, datasetName: m.datasetName, fields: m.fields as Record<string, string> })),
    canEdit: can(ctx.role, 'catalog:edit'),
  }
}

async function loadSourceRow(workspaceId: string, id: string): Promise<StoredDataSource & { config: unknown }> {
  const [s] = await db.select().from(dataSources).where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, workspaceId))).limit(1)
  if (!s) throw new Error('Data source not found')
  return s
}

type Sample = { rows: Record<string, unknown>[]; masked: string[]; mode: 'live' | 'cached'; freshness: Date | null; pushdown: boolean; truncated: boolean }

async function datasetSample(ctx: WorkspaceContext, datasetName: string): Promise<Sample> {
  const [d] = await db.select().from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, datasetName))).limit(1)
  if (!d) return { rows: [], masked: [], mode: 'cached', freshness: null, pushdown: true, truncated: false }
  const { masks, rowFilters } = await accessFor(ctx.workspaceId, d.name, ctx.role)
  const names = ((d.columns as Column[]) ?? []).map((c) => c.name)
  const rows = applyMasks(await readDatasetSample(d.tableName, 20, rowFilters, names), masks).map(({ _nexus_loaded_at, ...r }) => r)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'dataset', resourceId: d.id, changes: { what: 'catalog_sample', dataset: d.name, rows: rows.length } })
  return { rows, masked: Object.keys(masks), mode: 'cached', freshness: d.lastLoadedAt, pushdown: true, truncated: false }
}

/** Sample rows of a catalog item, masked and row-filtered for the viewer's role (DC-3). Live tables obey their guardrails (DV-3). */
async function getCatalogSampleImpl(rawKey: string): Promise<Sample> {
  const ctx = await requireWorkspace('data:preview')
  const key = z.string().min(1).max(400).parse(rawKey)
  const ref = parseKey(key)
  if (!ref) throw new Error('Unknown catalog item')
  if (ref.kind === 'dataset') return datasetSample(ctx, ref.datasetName)
  const source = await loadSourceRow(ctx.workspaceId, ref.dataSourceId)
  const [e] = await db.select().from(catalogEntries).where(and(eq(catalogEntries.workspaceId, ctx.workspaceId), eq(catalogEntries.key, key))).limit(1)
  if (e?.accessMode === 'cached' && e.alias) return datasetSample(ctx, e.alias)
  const limit = Math.min(20, e?.liveRowLimit ?? 1000)
  const res = await liveQuery(source, ref.tableName, { limit, timeoutMs: (e?.liveTimeoutSeconds ?? 30) * 1000 })
  const columns = Array.from(new Set(res.rows.flatMap((r) => Object.keys(r))))
  const { masks } = await liveTableAccess(ctx.workspaceId, e?.alias ?? null, ctx.role, columns)
  await recordAudit(ctx, { action: 'VIEW_DATA', resource: 'data_source', resourceId: source.id, changes: { what: 'catalog_live_sample', table: ref.tableName, rows: res.rows.length } })
  return { rows: applyMasks(res.rows, masks), masked: Object.keys(masks), mode: 'live', freshness: new Date(), pushdown: res.pushdown, truncated: res.truncated }
}

/** Documents a catalog item; for source tables also sets live/cached access and the cache refresh. */
async function saveCatalogEntryImpl(input: z.input<typeof catalogInputSchema>) {
  const ctx = await requireWorkspace('catalog:edit')
  const data = catalogInputSchema.parse(input)
  const ref = parseKey(data.key)
  if (!ref) throw new Error('Unknown catalog item')

  const memberIds = new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(eq(workspaceMembers.workspaceId, ctx.workspaceId))).map((m) => m.id))
  for (const id of [data.ownerId, data.stewardId]) if (id && !memberIds.has(id)) throw new Error('Owners and stewards must be members of this workspace.')

  const [existing] = await db.select().from(catalogEntries).where(and(eq(catalogEntries.workspaceId, ctx.workspaceId), eq(catalogEntries.key, data.key))).limit(1)
  const now = new Date()
  let values: Partial<Entry> = {
    description: data.description,
    ownerId: data.ownerId,
    stewardId: data.stewardId,
    tags: [...new Set(data.tags.map((t) => t.toLowerCase()))],
    classification: data.classification,
    columnDocs: Object.fromEntries(Object.entries(data.columnDocs).filter(([, v]) => v)),
    updatedBy: ctx.userId,
    updatedAt: now,
  }

  if (ref.kind === 'dataset') {
    const [d] = await db.select({ id: nexusDatasets.id }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, ref.datasetName))).limit(1)
    if (!d) throw new Error('Dataset not found')
    values = { ...values, kind: 'dataset', datasetName: ref.datasetName }
  } else {
    const source = await loadSourceRow(ctx.workspaceId, ref.dataSourceId)
    const scan = ((source.config ?? {}) as { schemaScan?: SchemaScanResult }).schemaScan
    if (!scan?.tables.some((t) => t.name === ref.tableName)) throw new Error('This table is no longer in the source. Re-test the data source to refresh its tables.')
    if (data.alias) {
      const clash = await db.select({ key: catalogEntries.key }).from(catalogEntries).where(and(eq(catalogEntries.workspaceId, ctx.workspaceId), eq(catalogEntries.alias, data.alias))).limit(1)
      if (clash[0] && clash[0].key !== data.key) throw new Error(`The name "${data.alias}" is already used by another catalog table.`)
      // A cached copy writes a dataset named after the alias: never overwrite a dataset another pipeline produces.
      if (data.accessMode === 'cached') {
        const [d] = await db.select({ pipelineId: nexusDatasets.pipelineId }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, data.alias))).limit(1)
        if (d && d.pipelineId && d.pipelineId !== existing?.cachePipelineId) throw new Error(`Dataset "${data.alias}" already exists and is written by another pipeline. Choose another name.`)
      }
    }
    if (data.refreshAfterPipelineId) {
      const [p] = await db.select({ id: pipelines.id }).from(pipelines).where(and(eq(pipelines.id, data.refreshAfterPipelineId), eq(pipelines.workspaceId, ctx.workspaceId))).limit(1)
      if (!p) throw new Error('The pipeline chosen to trigger the refresh does not exist.')
    }
    let cachePipelineId = existing?.cachePipelineId ?? null
    if (data.accessMode === 'cached') {
      cachePipelineId = await upsertCachePipeline(ctx, {
        pipelineId: cachePipelineId,
        name: `Cache · ${source.name} · ${ref.tableName}`,
        dataSourceId: source.id,
        table: ref.tableName,
        datasetName: data.alias!,
        refresh: data.refresh,
        afterPipelineId: data.refreshAfterPipelineId,
        maxRows: 1_000_000,
        enabled: true,
      })
    } else if (cachePipelineId) {
      await pauseManagedPipeline(ctx.workspaceId, cachePipelineId)
    }
    values = {
      ...values,
      kind: 'source_table',
      dataSourceId: source.id,
      tableName: ref.tableName,
      accessMode: data.accessMode,
      alias: data.alias,
      refresh: data.refresh,
      refreshAfterPipelineId: data.refresh === 'after_pipeline' ? data.refreshAfterPipelineId : null,
      cachePipelineId,
      liveRowLimit: data.liveRowLimit,
      liveTimeoutSeconds: data.liveTimeoutSeconds,
    }
  }

  if (existing) {
    await db.update(catalogEntries).set(values).where(eq(catalogEntries.id, existing.id))
  } else {
    await db.insert(catalogEntries).values({ id: newId('cat'), workspaceId: ctx.workspaceId, key: data.key, kind: ref.kind, ...values, updatedBy: ctx.userId } as typeof catalogEntries.$inferInsert)
  }
  await recordAudit(ctx, {
    action: existing ? 'UPDATE' : 'CREATE',
    resource: 'catalog_entry',
    resourceId: data.key,
    changes: { classification: data.classification, tags: values.tags, ...(ref.kind === 'source_table' ? { accessMode: data.accessMode, alias: data.alias, refresh: data.refresh } : {}) },
    diff: existing ? diffObjects(existing as unknown as Record<string, unknown>, { ...existing, ...values } as Record<string, unknown>, { ignore: ['updatedBy', 'id', 'workspaceId', 'key', 'kind'] }) : undefined,
  })
  revalidatePath('/dashboard', 'layout')
  // A newly cached table gets its first copy right away.
  if (ref.kind === 'source_table' && data.accessMode === 'cached' && values.cachePipelineId && existing?.accessMode !== 'cached') {
    const outcome = await enqueueRun(values.cachePipelineId, { workspaceId: ctx.workspaceId, actorId: ctx.userId }, 'manual')
    if (outcome.status === 'queued') startWorker()
  }
}

/** Refreshes a cached table now. */
async function refreshCatalogCacheImpl(rawKey: string) {
  const ctx = await requireWorkspace('pipelines:run')
  const key = z.string().min(1).max(400).parse(rawKey)
  const [e] = await db.select().from(catalogEntries).where(and(eq(catalogEntries.workspaceId, ctx.workspaceId), eq(catalogEntries.key, key))).limit(1)
  if (!e?.cachePipelineId || e.accessMode !== 'cached') throw new Error('This table is not cached.')
  const outcome = await enqueueRun(e.cachePipelineId, { workspaceId: ctx.workspaceId, actorId: ctx.userId }, 'manual')
  if (outcome.status === 'queued') startWorker()
  await recordAudit(ctx, { action: 'RUN', resource: 'pipeline', resourceId: e.cachePipelineId, changes: { trigger: 'catalog_refresh', runId: outcome.runId } })
  return outcome
}

// ── Lineage (DC-4) and quality history (DQ-4) ────────────────────────────────

/** Everything connected to a catalog item: sources → pipelines → datasets → dashboards / API entities. Metadata only. */
async function getLineageImpl(rawKey: string): Promise<LineageGraph> {
  const ctx = await requireWorkspace()
  const key = z.string().min(1).max(400).parse(rawKey)
  const [sources, pipes, dashes, mappings] = await Promise.all([
    db.select({ id: dataSources.id, name: dataSources.name }).from(dataSources).where(eq(dataSources.workspaceId, ctx.workspaceId)),
    db.select({ id: pipelines.id, name: pipelines.name, config: pipelines.config, schedule: pipelines.schedule }).from(pipelines).where(eq(pipelines.workspaceId, ctx.workspaceId)),
    db.select({ id: dashboards.id, name: dashboards.name, widgets: dashboards.widgets }).from(dashboards).where(eq(dashboards.workspaceId, ctx.workspaceId)),
    db.select({ entity: domainMappings.entity, datasetName: domainMappings.datasetName }).from(domainMappings).where(eq(domainMappings.workspaceId, ctx.workspaceId)),
  ])
  return buildLineage(key, {
    sources,
    pipelines: pipes.flatMap((p) => {
      const def = definitionSchema.safeParse(p.config)
      const schedule = scheduleSchema.safeParse(p.schedule ?? {})
      return def.success ? [{ id: p.id, name: p.name, definition: def.data, after: schedule.success && schedule.data.type === 'after' ? schedule.data.afterPipelineId : null }] : []
    }),
    dashboards: dashes.map((d) => ({ id: d.id, name: d.name, datasets: [...new Set(((d.widgets as { dataset?: string }[]) ?? []).map((w) => w.dataset).filter((x): x is string => Boolean(x)))] })),
    entities: mappings,
  })
}

/** Daily quality snapshots of a dataset for the last 30 days, plus current freshness. */
async function getQualityHistoryImpl(rawName: string) {
  const ctx = await requireWorkspace()
  const name = z.string().trim().min(1).max(63).parse(rawName)
  const since = jakartaDay(new Date(Date.now() - 30 * 86_400_000))
  const [rows, [d]] = await Promise.all([
    db
      .select()
      .from(datasetQualitySnapshots)
      .where(and(eq(datasetQualitySnapshots.workspaceId, ctx.workspaceId), eq(datasetQualitySnapshots.datasetName, name), gte(datasetQualitySnapshots.day, since)))
      .orderBy(datasetQualitySnapshots.day),
    db.select({ lastLoadedAt: nexusDatasets.lastLoadedAt }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, name))).limit(1),
  ])
  const num = (v: string | null) => (v === null ? null : Number(v))
  return {
    days: rows.map((r) => ({ day: r.day, rowCount: r.rowCount, completeness: num(r.completeness), uniqueness: num(r.uniqueness), validity: num(r.validity), score: num(r.score) })),
    freshnessHours: d?.lastLoadedAt ? Math.round(((Date.now() - new Date(d.lastLoadedAt).getTime()) / 3_600_000) * 10) / 10 : null,
  }
}

// ── Domain mappings (API-3) ──────────────────────────────────────────────────

const mappingInput = z.object({
  entity: z.string().min(1).max(40),
  datasetName: z.string().trim().min(1).max(63),
  fields: z.record(z.string().max(64), z.string().max(128)),
})

/** Publishes a dataset as a Unified Data Model entity: canonical field → dataset column. */
async function saveDomainMappingImpl(input: z.input<typeof mappingInput>) {
  const ctx = await requireWorkspace('catalog:edit')
  const data = mappingInput.parse(input)
  const entity = DOMAIN_BY_NAME.get(data.entity)
  if (!entity) throw new Error('Unknown entity')
  const [d] = await db.select({ columns: nexusDatasets.columns }).from(nexusDatasets).where(and(eq(nexusDatasets.workspaceId, ctx.workspaceId), eq(nexusDatasets.name, data.datasetName))).limit(1)
  if (!d) throw new Error('Dataset not found')
  const columns = new Set(((d.columns as Column[]) ?? []).map((c) => c.name))
  const fields = Object.fromEntries(Object.entries(data.fields).filter(([canonical, col]) => col && entity.fields.some((f) => f.name === canonical)))
  for (const col of Object.values(fields)) if (!columns.has(col)) throw new Error(`Column "${col}" is not in ${data.datasetName}.`)
  if (!fields[entity.key]) throw new Error(`Map the key field "${entity.key}" (${entity.fields.find((f) => f.name === entity.key)?.label}).`)
  await db
    .insert(domainMappings)
    .values({ id: newId('dom'), workspaceId: ctx.workspaceId, entity: entity.name, datasetName: data.datasetName, fields, updatedBy: ctx.userId })
    .onConflictDoUpdate({ target: [domainMappings.workspaceId, domainMappings.entity], set: { datasetName: data.datasetName, fields, updatedBy: ctx.userId, updatedAt: new Date() } })
  await recordAudit(ctx, { action: 'UPDATE', resource: 'domain_mapping', resourceId: entity.name, changes: { datasetName: data.datasetName, fields: Object.keys(fields) } })
  revalidatePath('/dashboard', 'layout')
}

async function deleteDomainMappingImpl(rawEntity: string) {
  const ctx = await requireWorkspace('catalog:edit')
  const entity = z.string().min(1).max(40).parse(rawEntity)
  await db.delete(domainMappings).where(and(eq(domainMappings.workspaceId, ctx.workspaceId), eq(domainMappings.entity, entity)))
  await recordAudit(ctx, { action: 'DELETE', resource: 'domain_mapping', resourceId: entity })
  revalidatePath('/dashboard', 'layout')
}

// ── AI-5: natural-language catalog search ───────────────────────────────────

const askCatalogInput = z.object({ question: z.string().trim().min(3, 'Ask where some data is').max(500) })

/**
 * "Where is training hours by department?" → catalog items and the columns that answer it.
 * Synonym ranking always runs (no model needed); a configured model re-ranks the shortlist
 * and explains each hit. Only names, docs and column names are sent, never rows.
 */
async function askCatalogImpl(input: z.input<typeof askCatalogInput>) {
  const ctx = await requireWorkspace()
  const { question } = askCatalogInput.parse(input)
  const { items: all } = await listCatalogImpl()
  const items: SearchItem[] = all.map((i) => ({ key: i.key, kind: i.kind, name: i.name, sourceName: i.sourceName, description: i.description, tags: i.tags, domains: i.domains, columns: i.columns.map((c) => ({ name: c.name, doc: c.doc })) }))
  let hits: SearchHit[] = rankCatalog(question, items, 5)
  let via: 'keywords' | 'ai' = 'keywords'
  let model: string | null = null
  if ((await aiStatus(ctx.workspaceId)).ready && items.length) {
    // The model sees the best keyword candidates (or everything in a small catalog).
    const shortlist = items.length <= 40 ? items : rankCatalog(question, items, 40).map((h) => items.find((i) => i.key === h.key)!).filter(Boolean)
    if (shortlist.length) {
      try {
        const res = await askModel(ctx, 'catalog', catalogPrompt({ question, items: shortlist }), (answer) => checkCatalogAnswer(answer, shortlist))
        hits = res.value
        via = 'ai'
        model = res.model
      } catch (err) {
        // The keyword answer still stands when the model fails.
        console.error('[catalog] AI search failed:', err instanceof Error ? err.message : err)
      }
    }
  }
  return { via, model, results: hits.map((h) => ({ ...h, name: all.find((i) => i.key === h.key)?.name ?? h.key, kind: all.find((i) => i.key === h.key)?.kind ?? 'dataset', sourceName: all.find((i) => i.key === h.key)?.sourceName ?? null })) }
}

export async function askCatalog(...args: Parameters<typeof askCatalogImpl>) {
  return guard(() => askCatalogImpl(...args))
}

export async function listCatalog(...args: Parameters<typeof listCatalogImpl>) {
  return guard(() => listCatalogImpl(...args))
}

export async function getCatalogSample(...args: Parameters<typeof getCatalogSampleImpl>) {
  return guard(() => getCatalogSampleImpl(...args))
}

export async function saveCatalogEntry(...args: Parameters<typeof saveCatalogEntryImpl>) {
  return guard(() => saveCatalogEntryImpl(...args))
}

export async function refreshCatalogCache(...args: Parameters<typeof refreshCatalogCacheImpl>) {
  return guard(() => refreshCatalogCacheImpl(...args))
}

export async function getLineage(...args: Parameters<typeof getLineageImpl>) {
  return guard(() => getLineageImpl(...args))
}

export async function getQualityHistory(...args: Parameters<typeof getQualityHistoryImpl>) {
  return guard(() => getQualityHistoryImpl(...args))
}

export async function saveDomainMapping(...args: Parameters<typeof saveDomainMappingImpl>) {
  return guard(() => saveDomainMappingImpl(...args))
}

export async function deleteDomainMapping(...args: Parameters<typeof deleteDomainMappingImpl>) {
  return guard(() => deleteDomainMappingImpl(...args))
}
