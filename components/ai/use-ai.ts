'use client'

import { useEffect, useState } from 'react'
import { getAiSettings } from '@/lib/actions/ai'

type Status = Awaited<ReturnType<typeof getAiSettings>>

// One request per page load; Settings reloads the page after a change.
let cached: Promise<Status> | null = null

/** The workspace's AI assistant status (null while loading or if it can't be read). */
export function useAiStatus() {
  const [status, setStatus] = useState<Status | null>(null)
  useEffect(() => {
    let alive = true
    cached ??= getAiSettings().catch(() => {
      cached = null
      return null as unknown as Status
    })
    void cached.then((s) => alive && setStatus(s))
    return () => {
      alive = false
    }
  }, [])
  return status
}
