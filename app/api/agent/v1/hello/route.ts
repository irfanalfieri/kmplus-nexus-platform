import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agents, workspaces } from '@/lib/db/schema'
import { AGENT_PROTOCOL, helloSchema } from '@/lib/agent/protocol'
import { authenticateAgent } from '@/lib/agent/server'

export const dynamic = 'force-dynamic'

/** An agent introduces itself on start: version, host and the connections it offers (names and types only). */
export async function POST(req: Request) {
  const agent = await authenticateAgent(req)
  if (!agent) return Response.json({ error: 'Invalid or revoked agent token.' }, { status: 401 })
  const parsed = helloSchema.safeParse(await req.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid hello message.' }, { status: 400 })
  const hello = parsed.data
  if (hello.protocol > AGENT_PROTOCOL) return Response.json({ error: `This Nexus speaks agent protocol ${AGENT_PROTOCOL}; update Nexus or use an older agent.` }, { status: 400 })
  await db
    .update(agents)
    .set({ version: hello.version, hostname: hello.hostname || null, connections: hello.connections, ai: hello.ai, lastSeenAt: new Date() })
    .where(eq(agents.id, agent.id))
  const [ws] = await db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, agent.workspaceId)).limit(1)
  return Response.json({ agentId: agent.id, name: agent.name, workspace: ws?.name ?? '', protocol: AGENT_PROTOCOL })
}
