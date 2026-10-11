import { handle, listRunsApi, triggerRunApi } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** POST /api/v1/pipelines/:id/runs: queue a run of the published version (API-4). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(req, 'pipelines:run', (caller) => triggerRunApi(caller, id, new URL(req.url).origin))
}

/** GET /api/v1/pipelines/:id/runs: latest runs. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return handle(req, ['runs:read', 'pipelines:run'], (caller, query) => listRunsApi(caller, id, query))
}
