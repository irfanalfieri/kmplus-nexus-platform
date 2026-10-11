import { getRunApi, handle } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** GET /api/v1/runs/:id: status and row counts of a run (API-4). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(req, ['runs:read', 'pipelines:run'], (caller) => getRunApi(caller, id))
}
