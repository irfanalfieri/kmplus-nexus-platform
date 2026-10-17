'use client'

import { ENVIRONMENT_INFO, isEnvironment } from '@/lib/pipelines/promote'
import { useT } from '@/components/i18n/i18n-provider'

const STYLE: Record<string, string> = {
  dev: 'border-info/50 bg-info-soft text-info-text',
  staging: 'border-warning/60 bg-warning-soft text-warning-text',
  prod: 'border-danger/50 bg-danger-soft text-danger-text',
}

/** DEV / STAGING / PROD marker for a workspace in an environment group (GV-7). */
export function EnvironmentBadge({ environment, className = '' }: { environment: string | null | undefined; className?: string }) {
  const t = useT()
  if (!isEnvironment(environment)) return null
  return (
    <span className={`inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-[11px] font-medium tracking-wide ${STYLE[environment]} ${className}`} title={t(`auth.environment.${environment}`)}>
      {ENVIRONMENT_INFO[environment].short}
    </span>
  )
}
