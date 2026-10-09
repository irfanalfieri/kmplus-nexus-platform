/**
 * Test doubles for running server actions outside Next.js (integration tests).
 * scripts/run-ts.mjs --stubs swaps these in for next/headers, next/cache,
 * next/server and @/lib/auth. The signed-in user is whatever setTestUser() set.
 */

export interface TestUser {
  id: string
  email: string
  name: string
  twoFactorEnabled?: boolean
}

const state = globalThis as unknown as {
  __testUser?: TestUser | null
  __testCookies?: Map<string, string>
  __testAfter?: (() => unknown)[]
}
state.__testCookies ??= new Map()
state.__testAfter ??= []

export function setTestUser(user: TestUser | null) {
  state.__testUser = user
  state.__testCookies!.clear()
}

/** Callbacks queued with after(); tests run them explicitly. */
export function takeAfterCallbacks() {
  return state.__testAfter!.splice(0)
}

// next/headers
export async function headers() {
  return new Headers({ 'x-forwarded-for': '203.0.113.7', 'user-agent': 'nexus-integration-tests' })
}
export async function cookies() {
  const jar = state.__testCookies!
  return {
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }
}

// next/cache
export function revalidatePath() {}

// next/server
export function after(fn: () => unknown) {
  state.__testAfter!.push(fn)
}

// @/lib/auth
export const APP_NAME = 'KMPlus Nexus'
export const auth = {
  api: {
    async getSession() {
      const user = state.__testUser
      return user ? { user: { twoFactorEnabled: true, ...user }, session: { id: 'test-session' } } : null
    },
  },
}

// next/navigation
export function redirect(url: string): never {
  throw new Error(`redirect: ${url}`)
}

/** Rethrows the stub redirect so guard() lets it through, like Next does. */
export function unstable_rethrow(err: unknown) {
  if (err instanceof Error && err.message.startsWith('redirect: ')) throw err
}
