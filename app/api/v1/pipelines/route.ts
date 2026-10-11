import { handle, listPipelinesApi } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** GET /api/v1/pipelines */
export async function GET(req: Request) {
  return handle(req, ['runs:read', 'pipelines:run'], (caller) => listPipelinesApi(caller))
}
