import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { pipelineRunRejects } from '@/lib/db/schema'

/** Open quarantine rows in a workspace: the count beside Data quality in the rail. Numbers only. */
export async function countOpenQuarantine(workspaceId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(pipelineRunRejects)
    .where(and(eq(pipelineRunRejects.workspaceId, workspaceId), eq(pipelineRunRejects.status, 'open')))
  return row?.n ?? 0
}
