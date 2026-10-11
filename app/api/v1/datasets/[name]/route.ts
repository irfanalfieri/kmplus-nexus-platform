import { handle, readDataset } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** GET /api/v1/datasets/:name?fields=&filter[col][op]=&updated_since=&limit=&cursor= (API-2) */
export async function GET(req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params
  return handle(req, 'datasets:read', (caller, query) => readDataset(caller, decodeURIComponent(name), query))
}
