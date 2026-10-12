import { createHash, randomUUID } from 'node:crypto'
import { and, eq, isNull, lt, sql } from 'drizzle-orm'
import { db, pool } from '@/lib/db'
import { agentTasks, agents } from '@/lib/db/schema'
import { AGENT_OFFLINE_AFTER_MS, MAX_TASKS_PER_POLL, payloadSchemas, type AgentOp, type AgentPayload, type AgentTask } from './protocol'

/**
 * Nexus side of the agent protocol (#13). Code that needs a customer system
 * behind a firewall calls `callAgent()`: it queues a task, the agent claims it
 * on its next poll, runs it next to the database and posts the result, and
 * callAgent returns it (or throws the agent's error). Tasks live in
 * agent_tasks and are deleted once their result is read.
 */

/**
 * A data source served by an agent: config.agent = { agentId, connection }.
 * workspaceId is the data source's own; callAgent refuses an agent of another workspace.
 */
export function agentOf(source: { config: unknown; workspaceId?: string }): { agentId: string; connection: string; workspaceId: string } | null {
  const a = (source.config as { agent?: { agentId?: unknown; connection?: unknown } } | null)?.agent
  if (!a || typeof a.agentId !== 'string' || typeof a.connection !== 'string') return null
  if (!source.workspaceId) throw Object.assign(new Error('Agent-backed data source loaded without its workspace.'), { retryable: false })
  return { agentId: a.agentId, connection: a.connection, workspaceId: source.workspaceId }
}

export class AgentUnavailableError extends Error {}

export const hashAgentToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function authenticateAgent(req: Request) {
  const token = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') ?? '')?.[1]
  if (!token) return null
  const [agent] = await db.select().from(agents).where(and(eq(agents.tokenHash, hashAgentToken(token)), isNull(agents.revokedAt))).limit(1)
  return agent ?? null
}

/** Claims up to MAX_TASKS_PER_POLL queued tasks for the agent (oldest first; safe with concurrent polls). */
export async function claimTasks(agentId: string): Promise<AgentTask[]> {
  const { rows } = await pool.query<{ id: string; op: AgentOp; payload: unknown }>(
    `UPDATE agent_tasks SET status = 'claimed', "claimedAt" = now()
      WHERE id IN (SELECT id FROM agent_tasks WHERE "agentId" = $1 AND status = 'queued' ORDER BY "createdAt" LIMIT $2 FOR UPDATE SKIP LOCKED)
      RETURNING id, op, payload`,
    [agentId, MAX_TASKS_PER_POLL]
  )
  return rows
}

export async function completeTask(agentId: string, taskId: string, outcome: { ok: true; result: unknown } | { ok: false; error: string; retryable: boolean }) {
  const res = await db
    .update(agentTasks)
    .set(outcome.ok ? { status: 'done', result: outcome.result as object, finishedAt: new Date() } : { status: 'failed', error: outcome.error, retryable: outcome.retryable, finishedAt: new Date() })
    .where(and(eq(agentTasks.id, taskId), eq(agentTasks.agentId, agentId), eq(agentTasks.status, 'claimed')))
    .returning({ id: agentTasks.id })
  return res.length > 0
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ago(d: Date | null) {
  if (!d) return 'never'
  const s = Math.round((Date.now() - d.getTime()) / 1000)
  return s < 120 ? `${s} s ago` : `${Math.round(s / 60)} min ago`
}

/**
 * Runs an operation on an agent and waits for its result. Throws
 * AgentUnavailableError when the agent is revoked, offline or doesn't pick the
 * task up in time; an error the agent reports is rethrown with `retryable`.
 */
export async function callAgent<O extends AgentOp>(
  agentId: string,
  op: O,
  payload: AgentPayload<O>,
  opts: { timeoutMs?: number; claimTimeoutMs?: number; workspaceId: string }
): Promise<unknown> {
  const parsed = payloadSchemas[op].parse(payload)
  const [agent] = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1)
  if (agent && agent.workspaceId !== opts.workspaceId) throw Object.assign(new Error('This data source points at an agent of another workspace.'), { retryable: false })
  if (!agent || agent.revokedAt) throw Object.assign(new AgentUnavailableError('The Nexus Agent for this data source was removed. Point the data source at another agent.'), { retryable: false })
  if (!agent.lastSeenAt || Date.now() - agent.lastSeenAt.getTime() > AGENT_OFFLINE_AFTER_MS) {
    throw new AgentUnavailableError(`Nexus Agent "${agent.name}" is offline (last seen ${ago(agent.lastSeenAt)}). Start it on its host, then try again.`)
  }
  const id = `task_${randomUUID()}`
  await db.insert(agentTasks).values({ id, workspaceId: agent.workspaceId, agentId, op, payload: parsed as object })
  const started = Date.now()
  const timeoutMs = opts.timeoutMs ?? 120_000
  const claimTimeoutMs = opts.claimTimeoutMs ?? 30_000
  let wait = 150
  try {
    for (;;) {
      await sleep(wait)
      wait = Math.min(wait * 1.5, 1000)
      const [t] = await db.select({ status: agentTasks.status, result: agentTasks.result, error: agentTasks.error, retryable: agentTasks.retryable }).from(agentTasks).where(eq(agentTasks.id, id)).limit(1)
      if (!t) throw new AgentUnavailableError('The agent task disappeared.')
      if (t.status === 'done') return t.result
      if (t.status === 'failed') throw Object.assign(new Error(t.error ?? 'The agent reported an error.'), { retryable: t.retryable !== false })
      const elapsed = Date.now() - started
      if (t.status === 'queued' && elapsed > claimTimeoutMs) {
        throw new AgentUnavailableError(`Nexus Agent "${agent.name}" didn't pick up the request within ${Math.round(claimTimeoutMs / 1000)} s. Check that it is running.`)
      }
      if (elapsed > timeoutMs) throw new AgentUnavailableError(`Nexus Agent "${agent.name}" didn't answer within ${Math.round(timeoutMs / 1000)} s.`)
    }
  } finally {
    // Results can be large; the row is only a mailbox.
    await db.delete(agentTasks).where(eq(agentTasks.id, id)).catch(() => undefined)
  }
}

/** Housekeeping from the cron tick: tasks nobody collected. */
export async function pruneAgentTasks() {
  await db.delete(agentTasks).where(lt(agentTasks.createdAt, sql`now() - interval '1 hour'`))
}
