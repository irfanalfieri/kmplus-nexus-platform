import { unstable_rethrow } from 'next/navigation'
import type { ActionError } from './action-result'

/**
 * Runs a server action body and returns its error as a value, so the message
 * reaches the user in production (lib/action-result.ts). Next.js control flow
 * (redirect, notFound) still propagates. Credentials embedded in connection
 * URLs are redacted from messages.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<T | ActionError> {
  try {
    return await fn()
  } catch (err) {
    unstable_rethrow(err)
    return { __nexusError: userMessage(err) }
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
