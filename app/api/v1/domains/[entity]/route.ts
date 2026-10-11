import { handle, readDomain } from '@/lib/api/serve'

export const dynamic = 'force-dynamic'

/** GET /api/v1/domains/:entity: Unified Enterprise Data Model entities, e.g. employee (API-3). */
export async function GET(req: Request, { params }: { params: Promise<{ entity: string }> }) {
  const { entity } = await params
  return handle(req, 'domains:read', (caller, query) => readDomain(caller, entity, query))
}
