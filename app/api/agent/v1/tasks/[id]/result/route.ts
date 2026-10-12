import { gunzipSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents } from '@/lib/db/schema'
import { resultSchema } from '@/lib/agent/protocol'
import { authenticateAgent, completeTask } from '@/lib/agent/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** The agent's answer to a task; large answers arrive gzipped (Content-Encoding: gzip). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const agent = await authenticateAgent(req)
  if (!agent) return Response.json({ error: 'Invalid or revoked agent token.' }, { status: 401 })
  const { id } = await params
  let body: unknown
  try {
    const raw = Buffer.from(await req.arrayBuffer())
    const text = req.headers.get('content-encoding') === 'gzip' ? gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }).toString('utf8') : raw.toString('utf8')
    body = JSON.parse(text)
  } catch {
    return Response.json({ error: 'The result is not valid (gzipped) JSON.' }, { status: 400 })
  }
  const parsed = resultSchema.safeParse(body)
  if (!parsed.success) return Response.json({ error: 'Invalid result message.' }, { status: 400 })
  const accepted = await completeTask(agent.id, id, parsed.data.ok ? { ok: true, result: parsed.data.result ?? null } : { ok: false, error: parsed.data.error, retryable: parsed.data.retryable })
  await db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, agent.id))
  return Response.json({ accepted }, { status: accepted ? 200 : 409 })
}
