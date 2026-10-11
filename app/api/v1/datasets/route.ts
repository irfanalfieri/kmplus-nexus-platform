import { handle, listDatasets } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** GET /api/v1/datasets: what this API key can read. */
export async function GET(req: Request) {
  return handle(req, 'datasets:read', (caller) => listDatasets(caller))
}
