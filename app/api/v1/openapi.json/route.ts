import { openApiSpec } from '@/lib/api/openapi'

export const dynamic = 'force-dynamic'

/** GET /api/v1/openapi.json: public description of the Data API (API-6). */
export function GET(req: Request) {
  return Response.json(openApiSpec(new URL(req.url).origin), { headers: { 'Cache-Control': 'public, max-age=300', 'Access-Control-Allow-Origin': '*' } })
}
