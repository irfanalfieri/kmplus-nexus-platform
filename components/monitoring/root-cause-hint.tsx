'use client'

import Link from 'next/link'
import { Lightbulb } from 'lucide-react'
import { useT } from '@/components/i18n/i18n-provider'
import { ROOT_CAUSE_HREF, rootCause } from '@/lib/monitoring/root-cause'

/** MN-6: the likely cause of a run's error and what to do, when the message matches a known pattern. */
export function RootCauseHint({ message, compact = false }: { message: string | null | undefined; compact?: boolean }) {
  const t = useT()
  const cause = rootCause(message)
  if (!cause) return null
  const href = ROOT_CAUSE_HREF[cause]
  if (compact) {
    return (
      <p className="flex items-center gap-1 text-xs text-muted-foreground">
        <Lightbulb className="size-3 shrink-0" aria-hidden />
        <span className="sr-only">{t('hints.label')}: </span>
        {t(`hints.causes.${cause}.title`)}
      </p>
    )
  }
  return (
    <div className="rounded-md border border-info/40 bg-info-soft p-3 text-sm">
      <p className="flex items-center gap-1.5 font-medium">
        <Lightbulb className="size-4 text-info-text" aria-hidden />
        {t('hints.label')}: {t(`hints.causes.${cause}.title`)}
      </p>
      <p className="mt-1 text-xs">
        <span className="font-medium">{t('hints.fixLabel')}:</span> {t(`hints.causes.${cause}.fix`)}
        {href && (
          <>
            {' '}
            <Link href={href} className="font-medium text-info-text underline-offset-2 hover:underline">
              {t('hints.open')}
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
