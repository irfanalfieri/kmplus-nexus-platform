import { hostname } from 'node:os'
import { gzipSync } from 'node:zlib'
import { z } from 'zod'
import { AGENT_CONNECTOR_TYPES, AGENT_PROTOCOL, type AgentTask } from '@/lib/agent/protocol'
import { executeTask, type AgentEnvironment, type LocalConnection } from '@/lib/agent/execute'
import { publicEndpoint } from '@/lib/connectors/rest/agent-request'

/**
 * KMPlus Nexus Agent (#13): runs inside a customer's network and reaches
 * databases and systems Nexus can't, without opening any inbound port. It
 * connects out to Nexus over HTTPS, long-polls for work, runs it with its
 * local credentials, and posts the results. See agent/README.md.
 */

export const AGENT_VERSION = '1.3.0'

const connectionSchema = z.object({
  name: z.string().trim().min(1).max(100),
  type: z.enum(AGENT_CONNECTOR_TYPES),
  /** Nexus may write to it (pipeline destinations). Default: read-only. */
  writable: z.boolean().default(false),
  credentials: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
})

export const configSchema = z.object({
  /** Nexus address, e.g. https://kmplus-nexus-platform.vercel.app */
  url: z.string().url(),
  /** Agent token from Nexus → Settings → Nexus Agents (nxa_…). */
  token: z.string().startsWith('nxa_', 'The token starts with nxa_'),
  connections: z.array(connectionSchema).max(100).default([]),
  /** Optional local open-source model (Ollama, vLLM, LM Studio…), OpenAI-compatible. */
  ai: z.object({ baseUrl: z.string().url(), model: z.string().min(1), apiKey: z.string().optional() }).optional(),
  /** Tasks run at the same time. */
  concurrency: z.number().int().min(1).max(16).default(4),
  pollWaitSeconds: z.number().int().min(0).max(25).default(20),
})
export type AgentConfig = z.infer<typeof configSchema>

/** "${NAME}" in any string becomes the environment variable NAME (keeps passwords out of the file). */
export function expandEnv<T>(value: T, env: Record<string, string | undefined> = process.env): T {
  if (typeof value === 'string') {
    return value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_m, name: string) => {
      const v = env[name]
      if (v === undefined) throw new Error(`Environment variable ${name} is not set (used in the agent config).`)
      return v
    }) as T
  }
  if (Array.isArray(value)) return value.map((v) => expandEnv(v, env)) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expandEnv(v, env)])) as T
  return value
}

export function parseConfig(raw: unknown, env: Record<string, string | undefined> = process.env): AgentConfig {
  const config = configSchema.parse(expandEnv(raw, env))
  const u = new URL(config.url)
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  if (u.protocol !== 'https:' && !local) throw new Error('The Nexus url must use https.')
  const names = new Set<string>()
  for (const c of config.connections) {
    if (names.has(c.name.toLowerCase())) throw new Error(`Two connections are named "${c.name}".`)
    names.add(c.name.toLowerCase())
  }
  return config
}

export function environmentFor(config: AgentConfig): AgentEnvironment {
  const connections = new Map<string, LocalConnection>(
    config.connections.map((c) => [c.name, { name: c.name, type: c.type, writable: c.writable, credentials: Object.fromEntries(Object.entries(c.credentials).map(([k, v]) => [k, String(v)])) }])
  )
  return { connections, ai: config.ai ?? null }
}

export interface RunOptions {
  fetchImpl?: typeof fetch
  signal?: AbortSignal
  log?: (line: string) => void
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), resolve()), { once: true })
  })

class FatalError extends Error {}

/** Runs until the signal aborts (or the token is rejected). */
export async function runAgent(config: AgentConfig, opts: RunOptions = {}) {
  const f = opts.fetchImpl ?? fetch
  const log = opts.log ?? ((line: string) => console.log(`${new Date().toISOString()}  ${line}`))
  const base = config.url.replace(/\/+$/, '')
  const env = environmentFor(config)
  const auth = { authorization: `Bearer ${config.token}`, 'user-agent': `KMPlus-Nexus-Agent/${AGENT_VERSION}` }

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await f(`${base}/api/agent/v1${path}`, { ...init, headers: { ...auth, ...(init.headers as Record<string, string>) }, signal: opts.signal })
    if (res.status === 401) throw new FatalError('Nexus rejected the agent token (revoked or wrong). Create a new token in Settings → Nexus Agents.')
    return res
  }

  const hello = async () => {
    const res = await call('/hello', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: AGENT_VERSION, protocol: AGENT_PROTOCOL, hostname: hostname(), connections: config.connections.map((c) => ({ name: c.name, type: c.type, writable: c.writable, endpoint: publicEndpoint(Object.fromEntries(Object.entries(c.credentials).map(([k, v]) => [k, String(v)]))) })), ai: config.ai ? { model: config.ai.model } : null }),
    })
    const body = (await res.json().catch(() => ({}))) as { name?: string; workspace?: string; error?: string }
    if (!res.ok) throw new Error(body.error ?? `hello failed (HTTP ${res.status})`)
    return body
  }

  const report = async (task: AgentTask, result: unknown) => {
    const json = JSON.stringify(result)
    const big = json.length > 64_000
    const res = await call(`/tasks/${encodeURIComponent(task.id)}/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(big ? { 'content-encoding': 'gzip' } : {}) },
      body: big ? gzipSync(json) : json,
    })
    if (!res.ok && res.status !== 409) throw new Error(`Posting the result failed (HTTP ${res.status}).`)
  }

  const handle = async (task: AgentTask) => {
    const started = Date.now()
    const conn = (task.payload as { connection?: string } | null)?.connection
    const result = await executeTask(task, env)
    // Never log data or credentials: operation, connection, outcome.
    log(`${task.op}${conn ? ` ${conn}` : ''} ${Date.now() - started} ms ${result.ok ? 'ok' : `failed: ${result.error.slice(0, 200)}`}`)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await report(task, result)
      } catch (err) {
        if (err instanceof FatalError) throw err
        await sleep(1000 * (attempt + 1), opts.signal)
      }
    }
  }

  let backoff = 1000
  let hello_ = await (async () => {
    for (;;) {
      try {
        return await hello()
      } catch (err) {
        if (err instanceof FatalError || opts.signal?.aborted) throw err
        log(`Can't reach Nexus yet (${err instanceof Error ? err.message : err}); retrying in ${Math.round(backoff / 1000)} s`)
        await sleep(backoff, opts.signal)
        backoff = Math.min(backoff * 2, 30_000)
      }
    }
  })()
  log(`Connected to ${base} as "${hello_.name}" (workspace ${hello_.workspace}). Connections: ${config.connections.map((c) => `${c.name} (${c.type}${c.writable ? ', writable' : ''})`).join(', ') || 'none'}${config.ai ? `. AI model: ${config.ai.model}` : ''}`)

  const active = new Set<Promise<void>>()
  // A task that hits a fatal error (token revoked) stops the loop; it never rejects in the background.
  let fatal: Error | null = null
  let lastHello = Date.now()
  backoff = 1000
  while (!opts.signal?.aborted && !fatal) {
    if (active.size >= config.concurrency) {
      await Promise.race(active)
      continue
    }
    try {
      if (Date.now() - lastHello > 10 * 60_000) {
        hello_ = await hello()
        lastHello = Date.now()
      }
      const res = await call(`/tasks?wait=${active.size ? 0 : config.pollWaitSeconds}`)
      if (!res.ok) throw new Error(`poll failed (HTTP ${res.status})`)
      const { tasks } = (await res.json()) as { tasks: AgentTask[] }
      backoff = 1000
      for (const task of tasks) {
        const p: Promise<void> = handle(task)
          .catch((err) => {
            if (err instanceof FatalError) fatal = err
            else log(`task ${task.op} could not be reported: ${err instanceof Error ? err.message : err}`)
          })
          .finally(() => active.delete(p))
        active.add(p)
      }
      // Something is running: check for more work briefly, then wait for a slot.
      if (!tasks.length && active.size) await Promise.race([...active, sleep(250, opts.signal)])
    } catch (err) {
      if (err instanceof FatalError) throw err
      if (opts.signal?.aborted) break
      log(`Lost contact with Nexus (${err instanceof Error ? err.message : err}); retrying in ${Math.round(backoff / 1000)} s`)
      await sleep(backoff, opts.signal)
      backoff = Math.min(backoff * 2, 30_000)
    }
  }
  await Promise.allSettled(active)
  if (fatal) throw fatal
}

/** --check: tests every connection (and the AI model) locally, without Nexus. */
export async function checkConfig(config: AgentConfig, log: (line: string) => void = console.log) {
  const env = environmentFor(config)
  let ok = true
  for (const c of config.connections) {
    const res = await executeTask({ id: 'check', op: 'test', payload: { connection: c.name } }, env)
    const passed = res.ok && (res.result as { ok?: boolean }).ok !== false
    ok &&= passed
    log(`${passed ? 'OK  ' : 'FAIL'}  ${c.name} (${c.type})${passed ? '' : `: ${res.ok ? (res.result as { message?: string }).message : res.error}`}`)
  }
  if (config.ai) {
    const res = await executeTask({ id: 'check', op: 'ai', payload: { messages: [{ role: 'user', content: 'Reply with the word ready.' }], maxTokens: 10 } }, env)
    ok &&= res.ok
    log(`${res.ok ? 'OK  ' : 'FAIL'}  AI model ${config.ai.model}${res.ok ? '' : `: ${res.error}`}`)
  }
  return ok
}
