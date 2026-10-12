import { z } from 'zod'

/**
 * Nexus Agent protocol (#13). Shared by the Nexus server (lib/agent/server.ts,
 * app/api/agent/v1/*) and the agent program (agent/nexus-agent.ts). Pure.
 *
 *   agent → POST /api/agent/v1/hello                 who it is, its connections (names and types only)
 *   agent → GET  /api/agent/v1/tasks?wait=20         long poll: claims queued tasks
 *   agent → POST /api/agent/v1/tasks/<id>/result     { ok, result } or { ok: false, error, retryable } (may be gzipped)
 *
 * The agent only connects out over HTTPS, authenticated with a workspace agent
 * token (nxa_…). Credentials for its connections live in its own config file
 * and never reach Nexus; Nexus refers to a connection by name.
 */

export const AGENT_PROTOCOL = 1
export const AGENT_TOKEN_PREFIX = 'nxa_'
/** Longest a poll waits for work. */
export const MAX_POLL_WAIT_SECONDS = 25
/** Tasks one poll may claim. */
export const MAX_TASKS_PER_POLL = 4
/** An agent that hasn't polled for this long is offline. */
export const AGENT_OFFLINE_AFTER_MS = 90_000
/** Rows per write task (keeps request and response bodies small). */
export const WRITE_BATCH_ROWS = 1000

export const AGENT_OPS = ['test', 'scan', 'sample', 'readChunk', 'readRows', 'write', 'liveQuery', 'activeKeys', 'markDeleted', 'ai'] as const
export type AgentOp = (typeof AGENT_OPS)[number]

/** Connector types an agent can serve (file uploads live in Nexus itself). */
export const AGENT_CONNECTOR_TYPES = ['postgres', 'mysql', 'oracle', 'snowflake', 'sap', 'ldap', 'rest', 'talenta', 'supabase', 'kmplus'] as const

const watermark = z.object({ column: z.string().min(1).max(200), after: z.string().nullable() }).optional()
const conn = { connection: z.string().min(1).max(100) }

export const payloadSchemas = {
  test: z.object(conn),
  scan: z.object(conn),
  sample: z.object({ ...conn, table: z.string().min(1).max(300), limit: z.number().int().min(1).max(10_000) }),
  readChunk: z.object({ ...conn, table: z.string().min(1).max(300), offset: z.number().int().min(0), limit: z.number().int().min(1).max(50_000), maxRows: z.number().int().min(1), watermark, cacheKey: z.string().max(200) }),
  readRows: z.object({ ...conn, table: z.string().min(1).max(300), maxRows: z.number().int().min(1).max(1_000_000), watermark }),
  write: z.object({
    ...conn,
    table: z.string().min(1).max(300),
    mode: z.enum(['append', 'upsert']),
    keys: z.array(z.string()),
    columns: z.array(z.object({ name: z.string(), type: z.string() })),
    rows: z.array(z.record(z.string(), z.unknown())).max(WRITE_BATCH_ROWS),
    runId: z.string().optional(),
    chunk: z.number().int().optional(),
  }),
  liveQuery: z.object({ ...conn, table: z.string().min(1).max(300), limit: z.number().int().min(1).max(10_000), timeoutMs: z.number().int().min(100).max(120_000), filters: z.array(z.object({ column: z.string(), value: z.string() })).max(10) }),
  /** Mark missing rows deleted, step 1: keys of rows not marked yet (one page). */
  activeKeys: z.object({ ...conn, table: z.string().min(1).max(300), keys: z.array(z.string().min(1)).min(1).max(10), column: z.string().min(1).max(200), offset: z.number().int().min(0), limit: z.number().int().min(1).max(50_000) }),
  /** Step 2: mark these keys deleted. */
  markDeleted: z.object({ ...conn, table: z.string().min(1).max(300), keys: z.array(z.string().min(1)).min(1).max(10), column: z.string().min(1).max(200), keyValues: z.array(z.array(z.string())).max(WRITE_BATCH_ROWS) }),
  ai: z.object({
    messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant']), content: z.string().max(100_000) })).min(1).max(20),
    json: z.boolean().default(false),
    temperature: z.number().min(0).max(2).default(0.1),
    maxTokens: z.number().int().min(1).max(8000).default(1500),
  }),
} satisfies Record<AgentOp, z.ZodTypeAny>

export type AgentPayload<O extends AgentOp> = z.infer<(typeof payloadSchemas)[O]>

export interface AgentTask {
  id: string
  op: AgentOp
  payload: unknown
}

export const helloSchema = z.object({
  version: z.string().max(40),
  protocol: z.number().int(),
  hostname: z.string().max(200).default(''),
  connections: z.array(z.object({ name: z.string().min(1).max(100), type: z.string().max(40), writable: z.boolean().default(false) })).max(100),
  ai: z.object({ model: z.string().max(200) }).nullable().default(null),
})
export type AgentHello = z.infer<typeof helloSchema>

export const resultSchema = z.union([
  z.object({ ok: z.literal(true), result: z.unknown() }),
  z.object({ ok: z.literal(false), error: z.string().max(4000), retryable: z.boolean().default(true) }),
])
export type AgentResult = z.infer<typeof resultSchema>

/** JSON-safe values for rows sent over the wire: Dates → ISO, bigint → string, bytes → base64. */
export function wireValue(v: unknown): unknown {
  if (v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString()
  if (typeof v === 'bigint') return v.toString()
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(v)) return v.toString('base64')
  if (v instanceof Uint8Array) return Buffer.from(v).toString('base64')
  return v
}

export const wireRow = (row: Record<string, unknown>) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, wireValue(v)]))
