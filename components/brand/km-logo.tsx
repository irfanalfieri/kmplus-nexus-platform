import Image from 'next/image'
import { cn } from '@/lib/utils'

const onDark = '/brand/kmplus-logo-on-dark.png'
const onLight = '/brand/kmplus-logo-on-light.png'
// Intrinsic size of both files (1103 × 596).
const W = 1103
const H = 596

/**
 * The official KM+ logo (supplied 2026-10-13): "KM PLUS" lettering with the
 * teal rays. `onDark` keeps the white letters (the rail, dark panels),
 * `onLight` uses KM+ ink letters, `auto` follows the light/dark theme.
 * Never recolour or redraw it; size it by height.
 */
export function KmLogo({ tone = 'auto', className, alt = 'KMPlus', priority }: { tone?: 'auto' | 'onDark' | 'onLight'; className?: string; alt?: string; priority?: boolean }) {
  const img = (src: string, extra?: string, hidden?: boolean) => (
    <Image src={src} width={W} height={H} alt={hidden ? '' : alt} aria-hidden={hidden || undefined} priority={priority} sizes="160px" className={cn('h-8 w-auto', className, extra)} />
  )
  if (tone === 'onDark') return img(onDark)
  if (tone === 'onLight') return img(onLight)
  return (
    <>
      {img(onLight, 'dark:hidden')}
      {img(onDark, 'hidden dark:block', true)}
    </>
  )
}
