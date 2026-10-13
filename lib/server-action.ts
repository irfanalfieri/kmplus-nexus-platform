import { unstable_rethrow } from 'next/navigation'
import type { ActionError } from './action-result'
import { localizeServerError } from './i18n/server-errors'

/**
 * Runs a server action body and returns its error as a value, so the message
 * reaches the user in production (lib/action-result.ts). Next.js control flow
 * (redirect, notFound) still propagates. Credentials embedded in connection
 * URLs are redacted from messages, and the message is translated into the
 * caller's language (lib/i18n/server-errors.ts).
 */
export async function guard<T>(fn: () => Promise<T>): Promise<T | ActionError> {
  try {
    return await fn()
  } catch (err) {
    unstable_rethrow(err)
    return { __nexusError: localizeServerError(userMessage(err), await callerLocale()) }
  }
}

/** The caller's interface language (nexus_lang cookie); English outside a request. */
async function callerLocale() {
  try {
    const { getLocale } = await import('./i18n/server')
    return await getLocale()
  } catch {
    return 'en' as const
  }
}

function userMessage(err: unknown): string {
  // zod: report the first problem in plain words.
  if (err && typeof err === 'object' && (err as { name?: string }).name === 'ZodError' && Array.isArray((err as { issues?: unknown }).issues)) {
    const issue = (err as { issues: { path: (string | number)[]; message: string }[] }).issues[0]
    return issue ? `${issue.path.length ? `${issue.path.join('.')}: ` : ''}${issue.message}` : 'Invalid input.'
  }
  if (err instanceof Error && err.message) {
    return err.message.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(:[^\s/@]*)?@/gi, '$1•••@').slice(0, 1000)
  }
  console.error('[action] unexpected error:', err)
  return 'Something went wrong. Please try again.'
}
