import { ScimError, SCIM_CONTENT_TYPE, errorBody, paging, parsePatch, resourceTypes, schemas, serviceProviderConfig } from '@/lib/scim/protocol'
import { authenticateScim, createGroup, createUser, deleteGroup, deleteUser, getGroup, getUser, listGroups, listUsers, patchGroup, patchUser, replaceGroup, replaceUser, type ScimCaller } from '@/lib/scim/store'

export const dynamic = 'force-dynamic'

/**
 * SCIM 2.0 endpoint (GV-8): https://<host>/api/scim/v2 is the "Tenant URL" /
 * "SCIM connector base URL" in Entra ID or Okta, with a workspace SCIM token
 * (Settings → SCIM provisioning) as the bearer token.
 */

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': SCIM_CONTENT_TYPE, 'cache-control': 'no-store' } })

function baseUrl(req: Request) {
  const configured = process.env.BETTER_AUTH_URL?.replace(/\/+$/, '')
  return `${configured ?? new URL(req.url).origin}/api/scim/v2`
}

async function readBody(req: Request) {
  const text = await req.text()
  if (text.length > 1_000_000) throw new ScimError(413, 'Request body too large.', 'tooMany')
  if (!text.trim()) return {}
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new ScimError(400, 'The body is not valid JSON.', 'invalidSyntax')
  }
}

async function handle(req: Request, params: Promise<{ path?: string[] }>) {
  try {
    const base = baseUrl(req)
    const caller: ScimCaller = await authenticateScim(req, base)
    const [resource = '', id, ...rest] = (await params).path ?? []
    if (rest.length) throw new ScimError(404, 'Not found.')
    const query = new URL(req.url).searchParams
    const method = req.method.toUpperCase()

    switch (resource) {
      case 'ServiceProviderConfig':
        return json(200, serviceProviderConfig(base))
      case 'ResourceTypes':
        return json(200, resourceTypes(base))
      case 'Schemas':
        return json(200, schemas())
      case 'Users': {
        if (!id) {
          if (method === 'GET') {
            const { startIndex, count } = paging(query)
            return json(200, await listUsers(caller, query, startIndex, count))
          }
          if (method === 'POST') return json(201, await createUser(caller, await readBody(req)))
          break
        }
        if (method === 'GET') return json(200, await getUser(caller, id))
        if (method === 'PUT') return json(200, await replaceUser(caller, id, await readBody(req)))
        if (method === 'PATCH') return json(200, await patchUser(caller, id, parsePatch(await readBody(req))))
        if (method === 'DELETE') return (await deleteUser(caller, id), json(204))
        break
      }
      case 'Groups': {
        if (!id) {
          if (method === 'GET') {
            const { startIndex, count } = paging(query)
            return json(200, await listGroups(caller, query, startIndex, count))
          }
          if (method === 'POST') return json(201, await createGroup(caller, await readBody(req)))
          break
        }
        if (method === 'GET') return json(200, await getGroup(caller, id))
        if (method === 'PUT') return json(200, await replaceGroup(caller, id, await readBody(req)))
        if (method === 'PATCH') return json(200, await patchGroup(caller, id, parsePatch(await readBody(req))))
        if (method === 'DELETE') return (await deleteGroup(caller, id), json(204))
        break
      }
      default:
        throw new ScimError(404, `Unknown resource "${resource}". Use /Users or /Groups.`)
    }
    throw new ScimError(405, `${method} is not supported here.`)
  } catch (err) {
    if (err instanceof ScimError) return json(err.status, errorBody(err))
    console.error('[scim]', err instanceof Error ? err.message : err)
    return json(500, errorBody(new ScimError(500, 'Internal error.')))
  }
}

type Ctx = { params: Promise<{ path?: string[] }> }
export const GET = (req: Request, ctx: Ctx) => handle(req, ctx.params)
export const POST = (req: Request, ctx: Ctx) => handle(req, ctx.params)
export const PUT = (req: Request, ctx: Ctx) => handle(req, ctx.params)
export const PATCH = (req: Request, ctx: Ctx) => handle(req, ctx.params)
export const DELETE = (req: Request, ctx: Ctx) => handle(req, ctx.params)
