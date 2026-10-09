/**
 * Server action errors as values. Next.js production builds replace the
 * message of any error thrown from a server action with a generic text, so
 * actions return { __nexusError } instead (see lib/server-action.ts) and the
 * client entry points in lib/actions/* throw it again with the real message.
 * Client-safe.
 */

export interface ActionError {
  __nexusError: string
}

export function isActionError(value: unknown): value is ActionError {
  return !!value && typeof value === 'object' && typeof (value as ActionError).__nexusError === 'string'
}

/** Returns the action's value, or throws its error with the original message. */
export function unwrap<T>(value: T | ActionError): T {
  if (isActionError(value)) throw new Error(value.__nexusError)
  return value
}

type Unwrapped<M> = {
  [K in keyof M]: M[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<Exclude<R, ActionError>> : M[K]
}

/** Wraps every action of a module so it throws its error again on the client. */
export function unwrapActions<M extends object>(mod: M): Unwrapped<M> {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(mod)) {
    out[name] = typeof value === 'function' ? async (...args: unknown[]) => unwrap(await (value as (...a: unknown[]) => Promise<unknown>)(...args)) : value
  }
  return out as Unwrapped<M>
}
