'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'

/**
 * Deep links into a screen's features (`/dashboard/pipelines?import=1`,
 * `?edit=<id>`): once the screen has its data (`ready`), each key present in
 * the URL runs its handler and is removed from the address, so a refresh or
 * Back doesn't open it again. Used by "Go to" (lib/finder.ts), Help and
 * notifications; every link stays valid on its own.
 */
export function useUrlIntents(ready: boolean, handlers: Record<string, (value: string) => void>) {
  const params = useSearchParams()
  const pathname = usePathname()
  const current = useRef(handlers)
  current.current = handlers

  useEffect(() => {
    if (!ready) return
    const keys = Object.keys(current.current).filter((k) => params.has(k))
    if (!keys.length) return
    for (const k of keys) current.current[k](params.get(k) ?? '')
    const rest = new URLSearchParams(params.toString())
    for (const k of keys) rest.delete(k)
    const qs = rest.toString()
    // The native history API keeps Next's router (and useSearchParams) in step without a navigation.
    window.history.replaceState(window.history.state, '', `${pathname}${qs ? `?${qs}` : ''}${window.location.hash}`)
  }, [ready, params, pathname])
}

/**
 * Anchors into a screen whose sections load late (`/dashboard/governance#erasure`):
 * once ready, the section is scrolled into view and focused for keyboard and
 * screen-reader users. Also follows later hash changes on the same screen.
 */
export function useHashTarget(ready: boolean) {
  useEffect(() => {
    if (!ready) return
    const go = () => {
      const id = decodeURIComponent(window.location.hash.slice(1))
      const el = id ? document.getElementById(id) : null
      if (!el) return
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' })
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
    }
    const timer = window.setTimeout(go, 50)
    window.addEventListener('hashchange', go)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('hashchange', go)
    }
  }, [ready])
}
