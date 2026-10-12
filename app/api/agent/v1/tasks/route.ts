import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents } from '@/lib/db/schema'
import { MAX_POLL_WAIT_SECONDS } from '@/lib/agent/protocol'
import { authenticateAgent, claimTasks } from '@/lib/agent/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Long poll: returns as soon as tasks are queued for this agent, or an empty list after `wait` seconds. */
export async function GET(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return Response.json({ error: 'Invalid or revoked agent token.' }, { status: 401 })
  const wait = Math.min(MAX_POLL_WAIT_SECONDS, Math.max(0, Number(new URL(req.url).searchParams.get('wait') ?? 20) || 0))
  const deadline = Date.now() + wait * 1000
  await db.update(agents).set({ lastSeenAt: new Date() }).where(eq(agents.id, agent.id))
  for (;;) {
    const tasks = await claimTasks(agent.id)
    if (tasks.length || Date.now() >= deadline || req.signal.aborted) return Response.json({ tasks })
    await sleep(500)
  }
}
