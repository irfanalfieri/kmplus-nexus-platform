'use server'

import { z } from 'zod'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { agents, dataSources, pipelines } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/lib/connectors/install-check'
import { getConnectorDefinition, isConnectorSlug } from '@/lib/connectors/catalog'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit, type AuditAction } from '@/lib/audit'
import { diffObjects } from '@/lib/audit-diff'
import { hasCustomCredentialForm, maskCredentials, restoreSecrets } from '@/lib/connectors/secret-mask'
import { guard } from '@/lib/server-action'
import { DEFAULT_MAX_CALLS } from '@/lib/pipelines/definition'
import { restRequestDesign } from '@/lib/connectors/rest/agent-request'
import { forgetCachedSecrets, resolveSecretRefs } from '@/lib/secrets/resolve'
import { SECRET_MANAGER_SLUGS, hasSecretRefs, isSecretManager } from '@/lib/secrets/types'
import { secretManagerDriver } from '@/lib/secrets/managers'
import { sourceHealthChecks } from '@/lib/db/schema'
import { checkSourceHealth, recordScan } from '@/lib/connectors/health'
import { HEALTH_CHECK_MINUTES, describeChange, uptime, type SchemaDrift } from '@/lib/connectors/drift'
import type { SchemaScanResult } from '@/lib/connectors/types'

const idSchema = z.string().trim().min(1).max(100)
const roleSchema = z.enum(['source', 'destination'])
const credentialValues = z.record(z.string().max(100), z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]))

type AgentLink = { agentId: string; connection: string }
const agentLink = (config: unknown) => (config as { agent?: AgentLink } | null)?.agent ?? null

/** The agent and connection an agent-backed source uses, for the edit form (no credentials: Nexus has none). */
async function agentSummary(ctx: WorkspaceContext, link: AgentLink) {
  const [agent] = await db.select({ name: agents.name, connections: agents.connections }).from(agents).where(and(eq(agents.id, link.agentId), eq(agents.workspaceId, ctx.workspaceId))).limit(1)
  const conn = ((agent?.connections as { name: string; endpoint?: string }[] | undefined) ?? []).find((c) => c.name === link.connection)
  return { name: agent?.name ?? '?', connection: link.connection, endpoint: conn?.endpoint ?? null }
}

async function audit(ctx: WorkspaceContext, action: AuditAction, resourceId: string, changes?: Record<string, unknown>) {
  await recordAudit(ctx, { action, resource: 'data_source', resourceId, changes })
}

async function getOwned(ctx: WorkspaceContext, id: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId)))
    .limit(1)
  if (!source) throw new Error('Data source not found')
  return source
}

async function getDataSourcesImpl() {
  const ctx = await requireWorkspace()
  // Never send credentials to the client.
  return db
    .select({
      id: dataSources.id,
      userId: dataSources.userId,
      name: dataSources.name,
      type: dataSources.type,
      sourceType: dataSources.sourceType,
      config: dataSources.config,
      status: dataSources.status,
      lastConnected: dataSources.lastConnected,
      schemaDrift: dataSources.schemaDrift,
      createdAt: dataSources.createdAt,
      updatedAt: dataSources.updatedAt,
    })
    .from(dataSources)
    .where(eq(dataSources.workspaceId, ctx.workspaceId))
    .orderBy(desc(dataSources.createdAt))
}

const createInput = z.object({
  name: z.string().trim().min(1, 'Name is required').max(120),
  type: z.string().trim().min(1).max(60),
  sourceType: z.string().trim().min(1).max(60),
  config: z
    .object({ role: roleSchema.default('source'), schemaScan: z.unknown().optional() })
    .passthrough()
    .default({ role: 'source' }),
  credentials: credentialValues.default({}),
})

async function createDataSourceImpl(input: z.input<typeof createInput>) {
  const ctx = await requireWorkspace('sources:manage')
  const data = createInput.parse(input)
  // Agent-backed sources are created in Settings → Nexus Agents (agent ownership checked there).
  delete (data.config as Record<string, unknown>).agent
  if (!isConnectorSlug(data.sourceType)) throw new Error(`Unknown connector "${data.sourceType}".`)
  await assertConnectorInstalled(data.sourceType)

  const id = newId('src')
  // File sources store uploads in nexus_raw under their own storage key (DS-9); they have no credentials.
  const isFile = data.sourceType === 'file'
  const hasSchemaScan = Boolean(data.config.schemaScan) || isFile
  await db.insert(dataSources).values({
    id,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name: data.name,
    type: data.type,
    sourceType: data.sourceType,
    config: data.config,
    credentials: encryptCredentials(id, isFile ? { storageKey: id } : data.credentials, ctx.workspaceId),
    status: hasSchemaScan ? 'connected' : 'disconnected',
    lastConnected: hasSchemaScan ? new Date() : undefined,
    // Health checks (DS-7): every 15 minutes, none for uploaded files.
    healthCheckMinutes: isFile ? 0 : 15,
    nextHealthCheckAt: isFile ? null : new Date(Date.now() + 15 * 60_000),
  })
  await audit(ctx, 'CREATE', id, { sourceType: data.sourceType, role: data.config.role })
  revalidatePath('/dashboard', 'layout')
  return id
}

function asStrings(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/**
 * Tests the stored credentials and refreshes the schema scan: a manual health
 * check (DS-7), recorded in the source's history, with the new scan compared
 * against the previous one (DS-8).
 */
async function testConnectionImpl(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  if (!isConnectorSlug(source.sourceType)) throw new Error(`Unknown connector "${source.sourceType}".`)
  await assertConnectorInstalled(source.sourceType)
  // Agent-backed sources are tested by the agent, with its local credentials.
  const result = await checkSourceHealth(source, { trigger: 'manual', rescan: true })
  await audit(ctx, 'TEST_CONNECTION', source.id, { ok: result.ok, scanned: result.scanned, drift: result.drift ? result.drift.changes.length : 0 })
  revalidatePath('/dashboard', 'layout')
  if (!result.ok) throw new Error(result.message)
  const after = await getOwned(ctx, source.id)
  return { tables: ((after.config as { schemaScan?: SchemaScanResult } | null)?.schemaScan?.tables ?? []).length, drift: result.drift ? result.drift.changes.length : 0 }
}

const HEALTH_LIMIT = 100

/** Health history (DS-7) and unreviewed schema changes (DS-8) of a data source. */
async function getSourceHealthImpl(rawId: string) {
  const ctx = await requireWorkspace()
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const checks = await db
    .select({ id: sourceHealthChecks.id, checkedAt: sourceHealthChecks.checkedAt, ok: sourceHealthChecks.ok, latencyMs: sourceHealthChecks.latencyMs, message: sourceHealthChecks.message, trigger: sourceHealthChecks.trigger, scanned: sourceHealthChecks.scanned })
    .from(sourceHealthChecks)
    .where(and(eq(sourceHealthChecks.dataSourceId, source.id), eq(sourceHealthChecks.workspaceId, ctx.workspaceId)))
    .orderBy(desc(sourceHealthChecks.checkedAt))
    .limit(HEALTH_LIMIT)
  return {
    id: source.id,
    name: source.name,
    status: source.status ?? 'disconnected',
    intervalMinutes: source.healthCheckMinutes,
    nextCheckAt: source.nextHealthCheckAt,
    lastCheckAt: source.lastHealthCheckAt,
    failures: source.healthFailures,
    day: uptime(checks, 86_400_000),
    week: uptime(checks, 7 * 86_400_000),
    checks,
    drift: (source.schemaDrift as SchemaDrift | null) ?? null,
    scannedAt: (source.config as { schemaScan?: SchemaScanResult } | null)?.schemaScan?.scannedAt ?? null,
  }
}

/** How often the source is checked (0 = never). */
async function setHealthCheckIntervalImpl(rawId: string, rawMinutes: number) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const minutes = z.number().int().refine((m) => (HEALTH_CHECK_MINUTES as readonly number[]).includes(m), 'Choose one of the listed intervals.').parse(rawMinutes)
  await db
    .update(dataSources)
    .set({ healthCheckMinutes: minutes, nextHealthCheckAt: minutes > 0 ? new Date(Date.now() + minutes * 60_000) : null, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'data_source', resourceId: source.id, changes: { healthCheckMinutes: minutes }, diff: diffObjects({ healthCheckMinutes: source.healthCheckMinutes }, { healthCheckMinutes: minutes }) })
  revalidatePath('/dashboard', 'layout')
}

/** Marks the schema changes as reviewed (they stay in the health history). */
async function reviewSchemaDriftImpl(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const drift = source.schemaDrift as SchemaDrift | null
  if (!drift) return
  await db.update(dataSources).set({ schemaDrift: null, updatedAt: new Date() }).where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', source.id, { schemaDriftReviewed: drift.changes.map(describeChange) })
  revalidatePath('/dashboard', 'layout')
}

/**
 * Non-secret credential values for the edit form. Secret fields (type
 * "password" in the catalog) are never returned; the form leaves them blank.
 */
async function getEditableCredentialsImpl(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const stored = asStrings(decryptCredentials(source.id, source.credentials))
  // Agent-backed: the credentials live in the agent's config, not in Nexus. An intranet
  // API (REST) still has its request (path, paging …) designed here.
  const link = agentLink(source.config)
  if (link) {
    const agent = await agentSummary(ctx, link)
    if (source.sourceType !== 'rest') return { supported: false as const, sourceType: source.sourceType, agent }
    return { supported: true as const, custom: 'rest' as const, sourceType: source.sourceType, values: maskCredentials('rest', stored), agent }
  }
  if (hasCustomCredentialForm(source.sourceType)) {
    // REST / Salesforce: the full form, with secrets masked (see secret-mask.ts).
    return { supported: true as const, custom: source.sourceType as 'rest' | 'salesforce', sourceType: source.sourceType, values: maskCredentials(source.sourceType, stored) }
  }
  const definition = getConnectorDefinition(source.sourceType)
  if (!definition || !definition.credentialFields.length) {
    return { supported: false as const, sourceType: source.sourceType }
  }
  const values: Record<string, string> = {}
  const secretsSet: string[] = []
  for (const field of definition.credentialFields) {
    if (field.type === 'password') {
      if (stored[field.key] && hasSecretRefs({ v: stored[field.key] })) values[field.key] = stored[field.key]
      else if (stored[field.key]) secretsSet.push(field.key)
    } else {
      values[field.key] = stored[field.key] ?? ''
    }
  }
  return { supported: true as const, custom: null as null, sourceType: source.sourceType, fields: definition.credentialFields, values, secretsSet }
}

/**
 * Updates credentials: submitted values override stored ones, blank secret
 * fields keep their stored value. The merged credentials must pass a
 * connection test before they are saved (and the schema is re-scanned).
 */
async function updateDataSourceCredentialsImpl(rawId: string, rawValues: Record<string, unknown>) {
  const ctx = await requireWorkspace('sources:manage')
  const target = await getOwned(ctx, idSchema.parse(rawId))
  if (target.sourceType === 'file') throw new Error('File sources have no credentials. Upload files instead.')
  const viaAgent = Boolean(agentLink(target.config))
  if (viaAgent && target.sourceType !== 'rest') throw new Error("This data source is reached through a Nexus Agent; change its credentials in the agent's config file.")
  const source = target
  const values = asStrings(credentialValues.parse(rawValues))
  const stored = asStrings(decryptCredentials(source.id, source.credentials))
  if (viaAgent) {
    // Only the request is stored; the base URL and sign-in stay in the agent's config.
    const merged = restRequestDesign(restoreSecrets('rest', values, stored))
    const changed = [...new Set([...Object.keys(merged), ...Object.keys(stored)])].filter((k) => (merged[k] ?? '') !== (stored[k] ?? ''))
    return testAndSave(ctx, source, merged, changed)
  }
  if (hasCustomCredentialForm(source.sourceType)) {
    const merged = restoreSecrets(source.sourceType, values, stored)
    const changed = Object.keys(merged).filter((k) => merged[k] !== (stored[k] ?? ''))
    return testAndSave(ctx, source, merged, changed)
  }
  const definition = getConnectorDefinition(source.sourceType)
  if (!definition?.credentialFields.length || !isConnectorSlug(source.sourceType)) {
    throw new Error('Editing credentials for this connector type is not supported yet. Re-create the data source instead.')
  }
  const known = new Map(definition.credentialFields.map((f) => [f.key, f]))
  const merged = { ...stored }
  for (const [key, value] of Object.entries(values)) {
    const field = known.get(key)
    if (!field) continue
    if (field.type === 'password' && value === '') continue // keep stored secret
    merged[key] = value
  }
  const missing = definition.credentialFields.filter((f) => f.required && !merged[f.key]?.trim()).map((f) => f.label)
  if (missing.length) throw new Error(`Required: ${missing.join(', ')}`)
  return testAndSave(ctx, source, merged, Object.keys(values).filter((k) => known.has(k) && values[k] !== ''))
}

/** Saves merged credentials only if they pass a connection test; re-scans the schema. */
async function testAndSave(ctx: WorkspaceContext, source: typeof dataSources.$inferSelect, merged: Record<string, string>, changedFields: string[]) {
  if (!isConnectorSlug(source.sourceType)) throw new Error(`Unknown connector "${source.sourceType}".`)
  // Directly, or through the agent for agent-backed sources.
  const { testSource, scanSource } = await import('@/lib/agent/sources')
  if (source.sourceType === 'salesforce') {
    // Refresh the access token first so the saved credentials stay usable.
    const { resolveSalesforceAuth } = await import('@/lib/connectors/salesforce/oauth')
    try {
      const auth = await resolveSalesforceAuth(merged)
      if (auth.refreshed) Object.assign(merged, auth.refreshed)
    } catch (err) {
      return { ok: false as const, message: err instanceof Error ? err.message : 'Salesforce sign-in failed.' }
    }
  }
  // Secret references are resolved for the test only; the saved credentials keep the references.
  const live = await resolveSecretRefs(ctx.workspaceId, merged)
  const test = await testSource(source, live)
  if (!test.ok) return { ok: false as const, message: test.message }
  const scan = await scanSource(source, live)
  if (isSecretManager(source.sourceType)) forgetCachedSecrets()

  // The new scan is compared with the previous one (DS-8).
  await recordScan(source, scan, { credentials: encryptCredentials(source.id, merged, ctx.workspaceId), status: 'connected', lastConnected: new Date(), healthFailures: 0 })
  // Record which fields changed, never their values.
  await audit(ctx, 'UPDATE_CREDENTIALS', source.id, { fields: changedFields })
  revalidatePath('/dashboard', 'layout')
  return { ok: true as const, message: `${test.message} Found ${scan.tables.length} objects.` }
}

/** Secrets managers of the workspace, for the "Use a secret" picker in credential forms (names only). */
async function listSecretManagersImpl() {
  const ctx = await requireWorkspace('sources:manage')
  const rows = await db
    .select({ id: dataSources.id, name: dataSources.name, sourceType: dataSources.sourceType, status: dataSources.status })
    .from(dataSources)
    .where(and(eq(dataSources.workspaceId, ctx.workspaceId), inArray(dataSources.sourceType, [...SECRET_MANAGER_SLUGS])))
    .orderBy(dataSources.name)
  return rows
}

/** Names of the secrets a secrets manager can read (never their values), for the picker. */
async function listSecretNamesImpl(rawId: string, rawPrefix = '') {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  if (!isSecretManager(source.sourceType)) throw new Error('This data source is not a secrets manager.')
  const prefix = z.string().max(300).parse(rawPrefix)
  const credentials = await resolveSecretRefs(ctx.workspaceId, decryptCredentials(source.id, source.credentials))
  const names = await secretManagerDriver(source.sourceType).list(credentials, prefix)
  await audit(ctx, 'VIEW_DATA', source.id, { what: 'secret_names', count: names.length })
  return names
}

async function renameDataSourceImpl(rawId: string, rawName: string) {
  const ctx = await requireWorkspace('sources:manage')
  const id = idSchema.parse(rawId)
  const name = z.string().trim().min(1, 'Name is required').max(120).parse(rawName)
  const before = await getOwned(ctx, id)
  await db
    .update(dataSources)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'data_source', resourceId: id, changes: { name }, diff: diffObjects({ name: before.name }, { name }) })
  revalidatePath('/dashboard', 'layout')
}

/** Switches a data source between source and destination (pipelines only write to destinations). */
async function setDataSourceRoleImpl(rawId: string, rawRole: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const role = roleSchema.parse(rawRole)
  await db
    .update(dataSources)
    .set({ config: { ...(source.config as Record<string, unknown>), role }, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'data_source', resourceId: source.id, changes: { role }, diff: diffObjects({ role: (source.config as { role?: string })?.role ?? 'source' }, { role }) })
  revalidatePath('/dashboard', 'layout')
}

/** Calls one Enrich or "Changes data" step may make to this data source per run (admins; decided default 50,000). */
async function setMaxCallsPerRunImpl(rawId: string, rawMax: number) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const max = z.number().int().min(1).max(10_000_000).parse(rawMax)
  const before = Number((source.config as { maxCallsPerRun?: number } | null)?.maxCallsPerRun) || DEFAULT_MAX_CALLS
  await db
    .update(dataSources)
    .set({ config: { ...(source.config as Record<string, unknown>), maxCallsPerRun: max }, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await recordAudit(ctx, { action: 'UPDATE', resource: 'data_source', resourceId: source.id, changes: { maxCallsPerRun: max }, diff: diffObjects({ maxCallsPerRun: before }, { maxCallsPerRun: max }) })
  revalidatePath('/dashboard', 'layout')
}

async function deleteDataSourceImpl(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const id = idSchema.parse(rawId)
  const used = await db
    .select({ name: pipelines.name, config: pipelines.config, draftConfig: pipelines.draftConfig })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, ctx.workspaceId))
  // Any node of the published or draft definition (sources and every destination).
  const refers = (cfg: unknown) => JSON.stringify(cfg ?? {}).includes(`"dataSourceId":${JSON.stringify(id)}`)
  const dependents = used.filter((p) => refers(p.config) || refers(p.draftConfig)).map((p) => p.name)
  if (dependents.length) {
    throw new Error(`Used by pipeline${dependents.length > 1 ? 's' : ''} ${dependents.map((n) => `"${n}"`).join(', ')}. Change or delete ${dependents.length > 1 ? 'them' : 'it'} first.`)
  }
  const source = await getOwned(ctx, id)
  if (source.sourceType === 'file') {
    const { dropAllFileTables } = await import('@/lib/connectors/drivers/file')
    const storageKey = String(decryptCredentials(source.id, source.credentials).storageKey ?? '')
    if (storageKey) await dropAllFileTables(storageKey)
  }
  await db.delete(dataSources).where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'DELETE', id)
  revalidatePath('/dashboard', 'layout')
}

// ── Server actions: thin wrappers that return errors as values so their messages
// reach the user in production. Call them through lib/actions/data-sources.ts. ──

export async function getDataSources(...args: Parameters<typeof getDataSourcesImpl>) {
  return guard(() => getDataSourcesImpl(...args))
}

export async function createDataSource(...args: Parameters<typeof createDataSourceImpl>) {
  return guard(() => createDataSourceImpl(...args))
}

export async function testConnection(...args: Parameters<typeof testConnectionImpl>) {
  return guard(() => testConnectionImpl(...args))
}

export async function getEditableCredentials(...args: Parameters<typeof getEditableCredentialsImpl>) {
  return guard(() => getEditableCredentialsImpl(...args))
}

export async function updateDataSourceCredentials(...args: Parameters<typeof updateDataSourceCredentialsImpl>) {
  return guard(() => updateDataSourceCredentialsImpl(...args))
}

export async function listSecretManagers(...args: Parameters<typeof listSecretManagersImpl>) {
  return guard(() => listSecretManagersImpl(...args))
}

export async function listSecretNames(...args: Parameters<typeof listSecretNamesImpl>) {
  return guard(() => listSecretNamesImpl(...args))
}

export async function renameDataSource(...args: Parameters<typeof renameDataSourceImpl>) {
  return guard(() => renameDataSourceImpl(...args))
}

export async function setDataSourceRole(...args: Parameters<typeof setDataSourceRoleImpl>) {
  return guard(() => setDataSourceRoleImpl(...args))
}

export async function setMaxCallsPerRun(...args: Parameters<typeof setMaxCallsPerRunImpl>) {
  return guard(() => setMaxCallsPerRunImpl(...args))
}

export async function deleteDataSource(...args: Parameters<typeof deleteDataSourceImpl>) {
  return guard(() => deleteDataSourceImpl(...args))
}

export async function getSourceHealth(...args: Parameters<typeof getSourceHealthImpl>) {
  return guard(() => getSourceHealthImpl(...args))
}
export async function setHealthCheckInterval(...args: Parameters<typeof setHealthCheckIntervalImpl>) {
  return guard(() => setHealthCheckIntervalImpl(...args))
}
export async function reviewSchemaDrift(...args: Parameters<typeof reviewSchemaDriftImpl>) {
  return guard(() => reviewSchemaDriftImpl(...args))
}
