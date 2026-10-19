import { cn } from '@/lib/utils'

/**
 * The Nexus product logo (chosen 2026-10-19): the "bridge", a derivative of the
 * KM+ rays. Three teal bars bring data in, three cyan bars send it out, and a
 * square node (the mimic-panel breaker) joins them. In the wordmark the bridge
 * is the "x" of "Nexus". The node takes `currentColor`, so it follows the text
 * colour (ink on light grounds, white on the rail); the bars keep their brand
 * colours (`--brand-ray-in` / `--brand-ray-out` in app/globals.css).
 *
 * Always pair it with the official KM+ logo (`KmLogo`), never instead of it.
 * Static copies: public/brand/nexus-mark*.svg; app icons: public/icon*.
 */

const IN = { fill: 'var(--brand-ray-in)' }
const OUT = { fill: 'var(--brand-ray-out)' }

/** The bridge drawn around (0, 0); `bold` is the cut for 32 px and below (favicons). */
function Bridge({ bold = false }: { bold?: boolean }) {
  const r = bold ? 40 : 34
  const w = bold ? 20 : 14
  const long = bold ? 46 : 52
  const short = bold ? 32 : 40
  const angle = bold ? 36 : 32
  const node = bold ? 36 : 28
  const bar = (len: number, rotate: number) => <rect x={r} y={-w / 2} width={len} height={w} transform={rotate ? `rotate(${rotate})` : undefined} />
  return (
    <>
      <g style={IN}>
        {bar(long, 180)}
        {bar(short, 180 - angle)}
        {bar(short, 180 + angle)}
      </g>
      <g style={OUT}>
        {bar(long, 0)}
        {bar(short, -angle)}
        {bar(short, angle)}
      </g>
      <rect x={-node / 2} y={-node / 2} width={node} height={node} fill="currentColor" />
    </>
  )
}

/** The bridge mark on its own (square). Size it with width/height classes; colour the node with `text-*`. */
export function NexusMark({ className, title = 'KMPlus Nexus', bold = false }: { className?: string; title?: string | null; bold?: boolean }) {
  return (
    <svg viewBox="0 0 200 200" className={cn('size-8', className)} role={title ? 'img' : undefined} aria-label={title ?? undefined} aria-hidden={title ? undefined : true}>
      <g transform="translate(100 100)">
        <Bridge bold={bold} />
      </g>
    </svg>
  )
}

/**
 * "Nexus" with the bridge as the x. Sized by font size (`text-lg`, `text-[21px]` …),
 * set in the app's IBM Plex Sans SemiBold; the mark sits on the x-height.
 */
export function NexusWordmark({ className, label = 'Nexus' }: { className?: string; label?: string | null }) {
  return (
    <span
      className={cn('inline-flex items-start font-sans font-semibold tracking-[-0.02em] whitespace-nowrap', className)}
      // Inline, so a text-* size class (which tailwind-merge lets win over leading-*) can't change it: the mark's offset assumes 1.
      style={{ lineHeight: 1 }}
      role={label ? 'img' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <span aria-hidden>Ne</span>
      {/* The bold cut, so the bars match the SemiBold strokes; 1.15 × 0.68 em, cropped to the bars,
          its middle on the middle of the x-height. */}
      <svg viewBox="12 48 176 104" aria-hidden className="mx-[0.05em] mt-[0.277em] h-[0.68em] w-[1.15em] shrink-0">
        <g transform="translate(100 100)">
          <Bridge bold />
        </g>
      </svg>
      <span aria-hidden>us</span>
    </span>
  )
}
