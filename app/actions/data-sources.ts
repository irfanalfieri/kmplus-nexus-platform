'use server'

import { z } from 'zod'
import { and, desc, eq } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { dataSources, pipelines } from '@/lib/db/schema'
import { assertConnectorInstalled } from '@/app/actions/connectors'
import { getConnectorDefinition, isConnectorSlug } from '@/lib/connectors/catalog'
import { decryptCredentials, encryptCredentials } from '@/lib/security/credentials'
import { newId, requireWorkspace, type WorkspaceContext } from '@/lib/auth/session'
import { recordAudit, type AuditAction } from '@/lib/audit'
import { hasCustomCredentialForm, maskCredentials, restoreSecrets } from '@/lib/connectors/secret-mask'

const idSchema = z.string().trim().min(1).max(100)
const roleSchema = z.enum(['source', 'destination'])
const credentialValues = z.record(z.string().max(100), z.union([z.string().max(20000), z.number(), z.boolean(), z.null()]))

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

export async function getDataSources() {
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

export async function createDataSource(input: z.input<typeof createInput>) {
  const ctx = await requireWorkspace('sources:manage')
  const data = createInput.parse(input)
  if (!isConnectorSlug(data.sourceType)) throw new Error(`Unknown connector "${data.sourceType}".`)
  await assertConnectorInstalled(data.sourceType)

  const id = newId('src')
  const hasSchemaScan = Boolean(data.config.schemaScan)
  await db.insert(dataSources).values({
    id,
    userId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name: data.name,
    type: data.type,
    sourceType: data.sourceType,
    config: data.config,
    credentials: encryptCredentials(id, data.credentials),
    status: hasSchemaScan ? 'connected' : 'disconnected',
    lastConnected: hasSchemaScan ? new Date() : undefined,
  })
  await audit(ctx, 'CREATE', id, { sourceType: data.sourceType, role: data.config.role })
  revalidatePath('/dashboard')
  return id
}

function asStrings(values: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v == null ? '' : String(v)]))
}

/** Tests the stored credentials and refreshes the schema scan. */
export async function testConnection(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  if (!isConnectorSlug(source.sourceType)) throw new Error(`Unknown connector "${source.sourceType}".`)

  const { testConnectorConnection, scanConnectorSchema } = await import('@/lib/connectors/runtime')
  await assertConnectorInstalled(source.sourceType)
  const credentials = asStrings(decryptCredentials(source.id, source.credentials))
  const test = await testConnectorConnection(source.sourceType, credentials)
  if (!test.ok) throw new Error(test.message)

  const scan = await scanConnectorSchema(source.sourceType, credentials)
  await db
    .update(dataSources)
    .set({ status: 'connected', lastConnected: new Date(), updatedAt: new Date(), config: { ...(source.config as Record<string, unknown>), schemaScan: scan } })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  revalidatePath('/dashboard')
  return { tables: scan.tables.length }
}

/**
 * Non-secret credential values for the edit form. Secret fields (type
 * "password" in the catalog) are never returned; the form leaves them blank.
 */
export async function getEditableCredentials(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const stored = asStrings(decryptCredentials(source.id, source.credentials))
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
      if (stored[field.key]) secretsSet.push(field.key)
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
export async function updateDataSourceCredentials(rawId: string, rawValues: Record<string, unknown>) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const values = asStrings(credentialValues.parse(rawValues))
  const stored = asStrings(decryptCredentials(source.id, source.credentials))
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
  const { testConnectorConnection, scanConnectorSchema } = await import('@/lib/connectors/runtime')
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
  const test = await testConnectorConnection(source.sourceType, merged)
  if (!test.ok) return { ok: false as const, message: test.message }
  const scan = await scanConnectorSchema(source.sourceType, merged)

  await db
    .update(dataSources)
    .set({
      credentials: encryptCredentials(source.id, merged),
      config: { ...(source.config as Record<string, unknown>), schemaScan: scan },
      status: 'connected',
      lastConnected: new Date(),
      updatedAt: new Date(),
    })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  // Record which fields changed, never their values.
  await audit(ctx, 'UPDATE_CREDENTIALS', source.id, { fields: changedFields })
  revalidatePath('/dashboard')
  return { ok: true as const, message: `${test.message} Found ${scan.tables.length} objects.` }
}

export async function renameDataSource(rawId: string, rawName: string) {
  const ctx = await requireWorkspace('sources:manage')
  const id = idSchema.parse(rawId)
  const name = z.string().trim().min(1, 'Name is required').max(120).parse(rawName)
  await db
    .update(dataSources)
    .set({ name, updatedAt: new Date() })
    .where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', id, { name })
  revalidatePath('/dashboard')
}

/** Switches a data source between source and destination (pipelines only write to destinations). */
export async function setDataSourceRole(rawId: string, rawRole: string) {
  const ctx = await requireWorkspace('sources:manage')
  const source = await getOwned(ctx, idSchema.parse(rawId))
  const role = roleSchema.parse(rawRole)
  await db
    .update(dataSources)
    .set({ config: { ...(source.config as Record<string, unknown>), role }, updatedAt: new Date() })
    .where(and(eq(dataSources.id, source.id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'UPDATE', source.id, { role })
  revalidatePath('/dashboard')
}

export async function deleteDataSource(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const id = idSchema.parse(rawId)
  const used = await db
    .select({ name: pipelines.name, sourceId: pipelines.sourceId, destinationId: pipelines.destinationId })
    .from(pipelines)
    .where(eq(pipelines.workspaceId, ctx.workspaceId))
  const dependents = used.filter((p) => p.sourceId === id || p.destinationId === id).map((p) => p.name)
  if (dependents.length) {
    throw new Error(`Used by pipeline${dependents.length > 1 ? 's' : ''} ${dependents.map((n) => `"${n}"`).join(', ')}. Change or delete ${dependents.length > 1 ? 'them' : 'it'} first.`)
  }
  await db.delete(dataSources).where(and(eq(dataSources.id, id), eq(dataSources.workspaceId, ctx.workspaceId)))
  await audit(ctx, 'DELETE', id)
  revalidatePath('/dashboard')
}
