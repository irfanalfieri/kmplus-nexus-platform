'use client'

import { useEffect } from 'react'

/** Opens the print dialog once the page has drawn (DB-5 Export PDF). */
export function AutoPrint() {
  useEffect(() => {
    const timer = setTimeout(() => window.print(), 600)
    return () => clearTimeout(timer)
  }, [])
  return null
}
