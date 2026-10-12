import { cn } from '@/lib/utils'

/**
 * The thin geometric KM+ wordmark, redrawn in code until an official file is
 * supplied. Letters take the current text colour; the plus is KM+ teal.
 */
export function KmWordmark({ className, title = 'KMPlus' }: { className?: string; title?: string }) {
  return (
    <svg viewBox="0 0 62 24" role="img" aria-label={title} className={cn('h-6 w-auto', className)} fill="none" strokeWidth={2} strokeLinecap="square">
      <g stroke="currentColor">
        <path d="M2 2v20M2 13 13.5 2M6.2 9 14.5 22" />
        <path d="M20 22V2l9 13.5L38 2v20" />
      </g>
      <path d="M44 12h14M51 5v14" stroke="#3ddbd9" />
    </svg>
  )
}
