'use server'

import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { db } from '@/lib/db'
import { agents, dataSources } from '@/lib/db/schema'
import { newId, requireWorkspace } from '@/lib/auth/session'
import { recordAudit } from '@/lib/audit'
import { assertConnectorInstalled } from '@/lib/connectors/install-check'
import { encryptCredentials } from '@/lib/security/credentials'
import { AGENT_OFFLINE_AFTER_MS, AGENT_TOKEN_PREFIX } from '@/lib/agent/protocol'
import { hashAgentToken } from '@/lib/agent/server'
import { guard } from '@/lib/server-action'

/**
 * Nexus Agents (#13), Settings side: admins create an agent (its token is
 * shown once), see which agents are online and what connections they offer,
 * and add an agent connection as a data source. Nexus stores no credentials
 * for those sources: the agent keeps them.
 */

const idSchema = z.string().trim().min(1).max(100)

async function nexusUrl() {
  const configured = process.env.BETTER_AUTH_URL ?? (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null)
  if (configured) return configured.replace(/\/+$/, '')
  const h = await headers()
  return `${h.get('x-forwarded-proto') ?? 'https'}://${h.get('host')}`
}

type Advertised = { name: string; type: string; writable: boolean; endpoint?: string }

async function listAgentsImpl() {
  const ctx = await requireWorkspace('sources:manage')
  const rows = await db.select().from(agents).where(eq(agents.workspaceId, ctx.workspaceId)).orderBy(desc(agents.createdAt))
  const sources = await db
    .select({ id: dataSources.id, name: dataSources.name, agentId: sql<string | null>`${dataSources.config}->'agent'->>'agentId'`, connection: sql<string | null>`${dataSources.config}->'agent'->>'connection'` })
    .from(dataSources)
    .where(and(eq(dataSources.workspaceId, ctx.workspaceId), sql`${dataSources.config} ? 'agent'`))
  return {
    url: await nexusUrl(),
    agents: rows.map((a) => ({
      id: a.id,
      name: a.name,
      prefix: a.prefix,
      createdAt: a.createdAt,
      lastSeenAt: a.lastSeenAt,
      online: !a.revokedAt && Boolean(a.lastSeenAt) && Date.now() - a.lastSeenAt!.getTime() < AGENT_OFFLINE_AFTER_MS,
      version: a.version,
      hostname: a.hostname,
      revokedAt: a.revokedAt,
      ai: (a.ai as { model: string } | null) ?? null,
      connections: ((a.connections as Advertised[]) ?? []).map((c) => ({ ...c, dataSources: sources.filter((s) => s.agentId === a.id && s.connection === c.name).map((s) => ({ id: s.id, name: s.name })) })),
    })),
  }
}

const nameSchema = z.string().trim().min(1, 'Name the agent, e.g. "Jakarta office"').max(80)

/** Creates an agent; returns its token once (only a hash is stored) and a starter config. */
async function createAgentImpl(rawName: string) {
  const ctx = await requireWorkspace('sources:manage')
  const name = nameSchema.parse(rawName)
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const id = newId('agent')
  await db.insert(agents).values({ id, workspaceId: ctx.workspaceId, name, prefix: token.slice(0, 10), tokenHash: hashAgentToken(token), createdBy: ctx.userId })
  await recordAudit(ctx, { action: 'CREATE', resource: 'agent', resourceId: id, changes: { name } })
  revalidatePath('/dashboard', 'layout')
  const url = await nexusUrl()
  const config = {
    url,
    token,
    connections: [{ name: 'HR database', type: 'postgres', writable: false, credentials: { connectionString: '${HR_DB_URL}', schema: 'public' } }],
  }
  return { id, token, url, config: JSON.stringify(config, null, 2) }
}

async function revokeAgentImpl(rawId: string) {
  const ctx = await requireWorkspace('sources:manage')
  const id = idSchema.parse(rawId)
  const res = await db
    .update(agents)
    .set({ revokedAt: new Date(), revokedBy: ctx.userId })
    .where(and(eq(agents.id, id), eq(agents.workspaceId, ctx.workspaceId), isNull(agents.revokedAt)))
    .returning({ name: agents.name })
  if (!res.length) throw new Error('Agent not found or already revoked')
  await recordAudit(ctx, { action: 'REVOKE', resource: 'agent', resourceId: id, changes: { name: res[0].name } })
  revalidatePath('/dashboard', 'layout')
}

const addInput = z.object({
  agentId: idSchema,
  connection: z.string().trim().min(1).max(100),
  role: z.enum(['source', 'destination']).default('source'),
  name: z.string().trim().min(1).max(120).optional(),
})

/** Adds one of an agent's connections as a data source (no credentials in Nexus). */
async function addAgentDataSourceImpl(input: z.input<typeof addInput>) {
  const ctx = await requireWorkspace('sources:manage')
  const data = addInput.parse(input)
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, data.agentId), eq(agents.workspaceId, ctx.workspaceId), isNull(agents.revokedAt))).limit(1)
  if (!agent) throw new Error('Agent not found')
  const conn = ((agent.connections as Advertised[]) ?? []).find((c) => c.name === data.connection)
  if (!conn) throw new Error(`Agent "${agent.name}" doesn't offer a connection named "${data.connection}". Start the agent with it in its config.`)
  if (data.role === 'destination' && !conn.writable) throw new Error(`"${conn.name}" is read-only on the agent. Set "writable": true for it in the agent's config to use it as a destination.`)
  await assertConnectorInstalled(conn.type)
  const id = newId('src')
  const name = data.name ?? `${conn.name} (via ${agent.name})`
  await db.insert(dataSources).values({
    id,
    userId: ctx.userId,
    ownerId: ctx.userId,
    workspaceId: ctx.workspaceId,
    name,
    type: 'database',
    sourceType: conn.type,
    config: { role: data.role, agent: { agentId: agent.id, connection: conn.name } },
    // Nothing secret here: the agent holds the credentials.
    credentials: encryptCredentials(id, {}, ctx.workspaceId),
    status: 'disconnected',
    // First scheduled health check (DS-7) in 15 minutes.
    nextHealthCheckAt: new Date(Date.now() + 15 * 60_000),
  })
  await recordAudit(ctx, { action: 'CREATE', resource: 'data_source', resourceId: id, changes: { sourceType: conn.type, role: data.role, agent: agent.name, connection: conn.name } })
  revalidatePath('/dashboard', 'layout')
  return { id, name }
}

export async function listAgents(...args: Parameters<typeof listAgentsImpl>) {
  return guard(() => listAgentsImpl(...args))
}

export async function createAgent(...args: Parameters<typeof createAgentImpl>) {
  return guard(() => createAgentImpl(...args))
}

export async function revokeAgent(...args: Parameters<typeof revokeAgentImpl>) {
  return guard(() => revokeAgentImpl(...args))
}

export async function addAgentDataSource(...args: Parameters<typeof addAgentDataSourceImpl>) {
  return guard(() => addAgentDataSourceImpl(...args))
}
