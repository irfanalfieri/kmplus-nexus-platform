import { ENVIRONMENT_INFO, isEnvironment } from '@/lib/pipelines/promote'

const STYLE: Record<string, string> = {
  dev: 'border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  staging: 'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  prod: 'border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300',
}

/** DEV / STAGING / PROD marker for a workspace in an environment group (GV-7). */
export function EnvironmentBadge({ environment, className = '' }: { environment: string | null | undefined; className?: string }) {
  if (!isEnvironment(environment)) return null
  return (
    <span className={`inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold tracking-wide ${STYLE[environment]} ${className}`} title={`${ENVIRONMENT_INFO[environment].label} environment`}>
      {ENVIRONMENT_INFO[environment].short}
    </span>
  )
}
