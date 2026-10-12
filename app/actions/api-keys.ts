'use server'

import { z } from 'zod'
import { and, desc, eq, isNull } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { apiKeys, user } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { API_KEY_ROLES, API_SCOPES, generateKey } from '@/lib/api/keys'
import { guard } from '@/lib/server-action'

async function listApiKeysImpl() {
  const ctx = await requireWorkspace('api:manage')
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      role: apiKeys.role,
      scopes: apiKeys.scopes,
      rateLimitPerMinute: apiKeys.rateLimitPerMinute,
      createdAt: apiKeys.createdAt,
      createdByEmail: user.email,
      lastUsedAt: apiKeys.lastUsedAt,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    .leftJoin(user, eq(user.id, apiKeys.createdBy))
    .where(eq(apiKeys.workspaceId, ctx.workspaceId))
    .orderBy(desc(apiKeys.createdAt))
    .then((rows) => rows.map((r) => ({ ...r, scopes: r.scopes as string[] })))
}

const createInput = z.object({
  name: z.string().trim().min(1, 'Name the key, e.g. "KMS production"').max(80),
  role: z.enum(API_KEY_ROLES).default('analyst'),
  scopes: z.array(z.enum(API_SCOPES)).min(1, 'Choose at least one scope'),
  /** null = never expires */
  expiresInDays: z.number().int().min(1).max(730).nullable().default(365),
  rateLimitPerMinute: z.number().int().min(10).max(3000).default(120),
})

/** Creates a key and returns it once; only its hash is stored. */
async function createApiKeyImpl(input: z.input<typeof createInput>) {
  const ctx = await requireWorkspace('api:manage')
  const data = createInput.parse(input)
  const { key, hash, prefix } = generateKey()
  const id = newId('key')
  await db.insert(apiKeys).values({
    id,
    workspaceId: ctx.workspaceId,
    name: data.name,
    prefix,
    hash,
    role: data.role,
    scopes: data.scopes,
    rateLimitPerMinute: data.rateLimitPerMinute,
    createdBy: ctx.userId,
    expiresAt: data.expiresInDays ? new Date(Date.now() + data.expiresInDays * 86_400_000) : null,
  })
  await recordAudit(ctx, { action: 'CREATE', resource: 'api_key', resourceId: id, changes: { name: data.name, prefix, role: data.role, scopes: data.scopes, expiresInDays: data.expiresInDays, rateLimitPerMinute: data.rateLimitPerMinute } })
  revalidatePath('/dashboard', 'layout')
  return { id, key }
}

async function revokeApiKeyImpl(rawId: string) {
  const ctx = await requireWorkspace('api:manage')
  const id = z.string().min(1).max(100).parse(rawId)
  const res = await db
    .update(apiKeys)
    .set({ revokedAt: new Date(), revokedBy: ctx.userId })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.workspaceId, ctx.workspaceId), isNull(apiKeys.revokedAt)))
    .returning({ prefix: apiKeys.prefix })
  if (!res.length) throw new Error('Key not found or already revoked.')
  await recordAudit(ctx, { action: 'REVOKE', resource: 'api_key', resourceId: id, changes: { prefix: res[0].prefix } })
  revalidatePath('/dashboard', 'layout')
}

export async function listApiKeys(...args: Parameters<typeof listApiKeysImpl>) {
  return guard(() => listApiKeysImpl(...args))
}

export async function createApiKey(...args: Parameters<typeof createApiKeyImpl>) {
  return guard(() => createApiKeyImpl(...args))
}

export async function revokeApiKey(...args: Parameters<typeof revokeApiKeyImpl>) {
  return guard(() => revokeApiKeyImpl(...args))
}
