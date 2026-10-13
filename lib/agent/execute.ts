import { sampleConnectorTable, scanConnectorSchema, testConnectorConnection } from '@/lib/connectors/runtime'
import type { ConnectorCredentials, ConnectorSlug } from '@/lib/connectors/types'
import { NonRetryableError, listActiveKeys, liveQuery, markRowsDeleted, readSourceChunk, readSourceRows, writeToDataSource, type ReadCache, type StoredDataSource } from '@/lib/pipelines/io'
import type { OutputColumn } from '@/lib/pipelines/columns'
import { chatCompletion, type LlmConfig } from '@/lib/ai/llm'
import { withPrivateNetworkAccess } from '@/lib/net/safe-url'
import { mergeAgentRestRequest } from '@/lib/connectors/rest/agent-request'
import { payloadSchemas, wireRow, type AgentOp, type AgentResult, type AgentTask } from './protocol'

/**
 * Runs one task inside the Nexus Agent, with the same connector and pipeline
 * I/O code Nexus uses, against a connection from the agent's own config. The
 * credentials are local; results are JSON-safe rows.
 */

export interface LocalConnection {
  name: string
  type: string
  writable: boolean
  credentials: ConnectorCredentials
}

export interface AgentEnvironment {
  connections: Map<string, LocalConnection>
  ai: LlmConfig | null
}

/** Read caches per run (cacheKey), dropped after 15 minutes of no use. */
const caches = new Map<string, { cache: ReadCache; used: number }>()
function cacheFor(key: string): ReadCache {
  const now = Date.now()
  for (const [k, v] of caches) if (now - v.used > 15 * 60_000) caches.delete(k)
  const hit = caches.get(key) ?? { cache: new Map(), used: now }
  hit.used = now
  caches.set(key, hit)
  return hit.cache
}

/**
 * The connection's credentials for one task. For an intranet API (REST) the
 * request designed in Nexus is combined with the local base URL and sign-in;
 * the local fields always win and requests stay under the base URL.
 */
function credentialsFor(c: LocalConnection, request: Record<string, string> | undefined) {
  return c.type === 'rest' ? mergeAgentRestRequest(c.credentials, request) : c.credentials
}

function sourceFor(c: LocalConnection, request?: Record<string, string>): StoredDataSource {
  // Plain credentials (no envelope): decryptCredentials passes them through.
  return { id: `agent:${c.name}`, name: c.name, sourceType: c.type, config: { role: c.writable ? 'destination' : 'source' }, credentials: credentialsFor(c, request) }
}

/** Large reads are returned in smaller pieces (the worker continues from where a piece ends). */
const MAX_RESULT_BYTES = 8_000_000

export async function executeTask(task: AgentTask, env: AgentEnvironment): Promise<AgentResult> {
  try {
    // The agent runs inside the customer's network: its connections may use private and intranet addresses.
    return { ok: true, result: await withPrivateNetworkAccess(() => run(task.op, task.payload, env)) }
  } catch (err) {
    const retryable = !(err instanceof NonRetryableError) && (err as { retryable?: boolean })?.retryable !== false
    return { ok: false, error: err instanceof Error ? err.message : String(err), retryable }
  }
}

function connection(env: AgentEnvironment, name: string) {
  const c = env.connections.get(name)
  if (!c) throw new NonRetryableError(`This agent has no connection named "${name}". Connections: ${[...env.connections.keys()].join(', ') || 'none'}.`)
  return c
}

async function run(op: AgentOp, raw: unknown, env: AgentEnvironment): Promise<unknown> {
  switch (op) {
    case 'test': {
      const p = payloadSchemas.test.parse(raw)
      const c = connection(env, p.connection)
      return testConnectorConnection(c.type as ConnectorSlug, credentialsFor(c, p.request))
    }
    case 'scan': {
      const p = payloadSchemas.scan.parse(raw)
      const c = connection(env, p.connection)
      return scanConnectorSchema(c.type as ConnectorSlug, credentialsFor(c, p.request))
    }
    case 'sample': {
      const p = payloadSchemas.sample.parse(raw)
      const c = connection(env, p.connection)
      const res = await sampleConnectorTable(c.type as ConnectorSlug, credentialsFor(c, p.request), p.table, p.limit)
      return { ...res, rows: (res.rows ?? []).map((r: Record<string, unknown>) => wireRow(r)) }
    }
    case 'readChunk': {
      const p = payloadSchemas.readChunk.parse(raw)
      const c = connection(env, p.connection)
      const read = await readSourceChunk(sourceFor(c, p.request), p.table, { offset: p.offset, limit: p.limit, maxRows: p.maxRows, watermark: p.watermark, cache: cacheFor(p.cacheKey) })
      let rows = read.rows.map(wireRow)
      let exhausted = read.exhausted
      // Keep the answer well under request-size limits: send a prefix and let the worker ask for the rest.
      while (rows.length > 100 && JSON.stringify(rows).length > MAX_RESULT_BYTES) {
        rows = rows.slice(0, Math.floor(rows.length / 2))
        exhausted = false
      }
      return { rows, exhausted, types: read.types }
    }
    case 'readRows': {
      const p = payloadSchemas.readRows.parse(raw)
      const c = connection(env, p.connection)
      return (await readSourceRows(sourceFor(c, p.request), p.table, p.maxRows, { watermark: p.watermark })).map(wireRow)
    }
    case 'write': {
      const p = payloadSchemas.write.parse(raw)
      const c = connection(env, p.connection)
      if (!c.writable) throw new NonRetryableError(`Connection "${c.name}" is read-only on this agent. Set "writable": true in the agent's config to allow writes.`)
      const res = await writeToDataSource({ source: sourceFor(c), table: p.table, mode: p.mode, keys: p.keys, columns: p.columns as OutputColumn[], rows: p.rows, runId: p.runId, chunk: p.chunk })
      return { written: res.written, rejected: (res.rejected ?? []).map((r) => ({ row: wireRow(r.row), error: r.error })) }
    }
    case 'liveQuery': {
      const p = payloadSchemas.liveQuery.parse(raw)
      const c = connection(env, p.connection)
      const res = await liveQuery(sourceFor(c, p.request), p.table, { limit: p.limit, timeoutMs: p.timeoutMs, filters: p.filters })
      return { ...res, rows: res.rows.map(wireRow) }
    }
    case 'activeKeys': {
      const p = payloadSchemas.activeKeys.parse(raw)
      const c = connection(env, p.connection)
      if (!c.writable) throw new NonRetryableError(`Connection "${c.name}" is read-only on this agent; marking rows deleted needs "writable": true.`)
      return listActiveKeys(sourceFor(c), p)
    }
    case 'markDeleted': {
      const p = payloadSchemas.markDeleted.parse(raw)
      const c = connection(env, p.connection)
      if (!c.writable) throw new NonRetryableError(`Connection "${c.name}" is read-only on this agent; marking rows deleted needs "writable": true.`)
      return markRowsDeleted(sourceFor(c), p)
    }
    case 'ai': {
      const p = payloadSchemas.ai.parse(raw)
      if (!env.ai) throw new NonRetryableError('This agent has no local AI model. Add "ai": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5:7b" } to its config.')
      return chatCompletion(env.ai, p.messages, { json: p.json, temperature: p.temperature, maxTokens: p.maxTokens, timeoutMs: 110_000 })
    }
    default:
      // A newer Nexus asking an older agent.
      throw new NonRetryableError(`This agent doesn't support "${String(op)}". Update the Nexus Agent.`)
  }
}
