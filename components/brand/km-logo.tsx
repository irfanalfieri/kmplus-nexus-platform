import Image from 'next/image'
import { cn } from '@/lib/utils'
import onDark from '@/public/brand/kmplus-logo-on-dark.png'
import onLight from '@/public/brand/kmplus-logo-on-light.png'

/**
 * The official KM+ logo (supplied 2026-10-13): "KM PLUS" lettering with the
 * teal rays. `onDark` keeps the white letters (the rail, dark panels),
 * `onLight` uses KM+ ink letters, `auto` follows the light/dark theme.
 * Never recolour or redraw it; size it by height.
 */
export function KmLogo({ tone = 'auto', className, alt = 'KMPlus', priority }: { tone?: 'auto' | 'onDark' | 'onLight'; className?: string; alt?: string; priority?: boolean }) {
  const img = (src: typeof onDark, extra?: string, hidden?: boolean) => (
    <Image src={src} alt={hidden ? '' : alt} aria-hidden={hidden || undefined} priority={priority} sizes="160px" className={cn('h-8 w-auto', className, extra)} />
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
