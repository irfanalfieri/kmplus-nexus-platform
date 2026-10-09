import { randomUUID } from 'node:crypto'
import { headers } from 'next/headers'
import { auth } from '@/lib/auth'

/** Returns the signed-in user's id or throws. Use at the top of every server action. */
export async function requireUserId() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session?.user) throw new Error('Unauthorized')
  return session.user.id
}

/** Collision-free record id, e.g. newId('src') → "src_6f1c…". */
export function newId(prefix: string) {
  return `${prefix}_${randomUUID()}`
}
