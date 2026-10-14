'use client'

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, ArrowRight, BookOpen, Check, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/components/i18n/i18n-provider'
import { cn } from '@/lib/utils'
import type { MessageKey } from '@/lib/i18n/translate'
import { TOUR_STAGES, TOUR_STEPS, type TourStage } from '@/lib/tour/steps'

/**
 * "Guide me" (top bar): a guided tour that walks the workflow screen by screen
 * and points at the real controls. Non-blocking: the dimmed board stays usable,
 * so people can try what the card describes. Progress is the workflow drawn as
 * one line (stages as buses). Esc or "End tour" stops it; it resumes after a
 * reload. Reduced motion: no scrolling animation, no energising line.
 */

type TourContextValue = { start: () => void; active: boolean }
const TourContext = createContext<TourContextValue>({ start: () => undefined, active: false })
export const useTour = () => useContext(TourContext)

const STORAGE_KEY = 'nexus_tour'

function readSaved(): number | null {
  try {
    const v = Number(window.localStorage.getItem(STORAGE_KEY))
    return Number.isInteger(v) && v >= 0 && v < TOUR_STEPS.length && window.localStorage.getItem(STORAGE_KEY) !== null ? v : null
  } catch {
    return null
  }
}

function save(step: number | null) {
  try {
    if (step === null) window.localStorage.removeItem(STORAGE_KEY)
    else window.localStorage.setItem(STORAGE_KEY, String(step))
  } catch {
    /* private mode: the tour still runs, it just won't resume after a reload */
  }
}

export function TourProvider({ children }: { children: React.ReactNode }) {
  const [step, setStep] = useState<number | null>(null)

  useEffect(() => {
    const saved = readSaved()
    if (saved !== null) setStep(saved)
  }, [])

  const go = useCallback((next: number | null) => {
    setStep(next)
    save(next)
  }, [])

  return (
    <TourContext.Provider value={{ start: () => go(0), active: step !== null }}>
      {children}
      {step !== null && <TourOverlay step={step} onStep={go} />}
    </TourContext.Provider>
  )
}

type Rect = { top: number; left: number; width: number; height: number }

const PAD = 6
const CARD_W = 380

function findTarget(marker: string | undefined): HTMLElement | null {
  if (!marker) return null
  // Several elements may carry the marker (e.g. header and empty-state buttons): take the first visible one.
  const all = Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${marker}"]`))
  return all.find((el) => el.getClientRects().length > 0 && el.offsetParent !== null) ?? null
}

function TourOverlay({ step, onStep }: { step: number; onStep: (next: number | null) => void }) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const uid = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const current = TOUR_STEPS[step]
  const [rect, setRect] = useState<Rect | null>(null)
  const [missing, setMissing] = useState(false)
  const [narrow, setNarrow] = useState(false)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const here = pathname === current.route
  const show = useCallback(() => router.push(current.route), [current.route, router])

  // Open the step's screen when the step changes (not when the person browses elsewhere mid-tour).
  useEffect(() => {
    if (window.location.pathname !== current.route) show()
  }, [current.route, show])

  // Find the control (screens load their data first), bring it into view and follow it.
  useEffect(() => {
    setRect(null)
    setMissing(false)
    if (!here) return
    let el: HTMLElement | null = null
    let tries = 0
    let frame = 0
    let resize: ResizeObserver | null = null
    let follow = 0
    // Clipped to the viewport, so a tall target (a whole table) still reads as one ring.
    const measure = () => {
      if (!el) return
      const r = el.getBoundingClientRect()
      const top = Math.max(r.top - PAD, 8)
      const bottom = Math.min(r.bottom + PAD, window.innerHeight - 8)
      const next = { top, left: r.left - PAD, width: r.width + PAD * 2, height: Math.max(bottom - top, 0) }
      setRect((prev) => (prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next))
    }
    const poll = window.setInterval(() => {
      tries++
      el = current.target ? findTarget(current.target) : null
      const fallback = !el && (tries > 25 || !current.target) ? document.querySelector<HTMLElement>('main h1') : null
      if (el || fallback || tries > 40) {
        window.clearInterval(poll)
        if (!el && current.target) setMissing(true)
        el = el ?? fallback
        if (!el) return
        el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.6 ? 'start' : 'center', inline: 'nearest', behavior: reduced ? 'auto' : 'smooth' })
        measure()
        window.setTimeout(measure, reduced ? 0 : 350)
        // Screens load their rows after the control appears; follow its size.
        resize = new ResizeObserver(onMove)
        resize.observe(el)
        // Content above it can load later and push it down: keep following while the step is open.
        follow = window.setInterval(onMove, 250)
      }
    }, 120)
    const onMove = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onMove)
    document.addEventListener('scroll', onMove, true)
    return () => {
      window.clearInterval(poll)
      resize?.disconnect()
      window.clearInterval(follow)
      cancelAnimationFrame(frame)
      window.removeEventListener('resize', onMove)
      document.removeEventListener('scroll', onMove, true)
    }
  }, [current, here, reduced])

  useLayoutEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 640)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Focus the card on every step, so keyboard and screen-reader users follow along.
  useEffect(() => {
    cardRef.current?.focus({ preventScroll: true })
  }, [step])

  const last = step === TOUR_STEPS.length - 1
  const next = () => (last ? onStep(null) : onStep(step + 1))
  const back = () => step > 0 && onStep(step - 1)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc ends the tour unless a dialog or menu above it is open (it closes that first).
      if (e.key === 'Escape' && !document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"]')) onStep(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onStep])

  const onCardKey = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return
    if (e.key === 'ArrowRight') next()
    if (e.key === 'ArrowLeft') back()
  }

  // Card placement: below the control, else above, else beside; docked to the bottom on phones.
  const style: React.CSSProperties = {}
  if (narrow) {
    Object.assign(style, { left: 12, right: 12, bottom: 12 })
  } else if (!here) {
    Object.assign(style, { right: 24, bottom: 24, width: CARD_W })
  } else if (!rect) {
    Object.assign(style, { left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: CARD_W })
  } else {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const cardH = cardRef.current?.offsetHeight ?? 260
    const left = Math.min(Math.max(12, rect.left), vw - CARD_W - 12)
    if (rect.top + rect.height + 12 + cardH < vh) Object.assign(style, { top: rect.top + rect.height + 12, left, width: CARD_W })
    else if (rect.top - 12 - cardH > 0) Object.assign(style, { top: rect.top - 12 - cardH, left, width: CARD_W })
    else if (rect.left + rect.width + 12 + CARD_W < vw) Object.assign(style, { top: Math.min(Math.max(12, rect.top), vh - cardH - 12), left: rect.left + rect.width + 12, width: CARD_W })
    else if (rect.left - CARD_W - 12 > 0) Object.assign(style, { top: Math.min(Math.max(12, rect.top), vh - cardH - 12), left: rect.left - CARD_W - 12, width: CARD_W })
    // No room around a large target: dock in the corner, over it.
    else Object.assign(style, { right: 24, bottom: 24, width: CARD_W })
  }

  const stageIndex = TOUR_STAGES.indexOf(current.stage)
  const key = (k: string) => `tour.steps.${current.id}.${k}` as MessageKey

  return (
    <>
      {/* The spotlight: one hole in a dimmed board, ringed in live teal. Clicks pass through. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-40">
        {!here ? null : rect ? (
          <div
            className={cn(
              'absolute rounded-sm shadow-[0_0_0_200vmax_rgb(8_26_28/0.45)] ring-2 ring-live dark:shadow-[0_0_0_200vmax_rgb(0_0_0/0.6)]',
              !reduced && 'transition-[top,left,width,height] duration-200 ease-out',
            )}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
        ) : (
          <div className="absolute inset-0 bg-[#081a1c]/45 dark:bg-black/60" />
        )}
      </div>

      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={`${uid}-title`}
        aria-describedby={`${uid}-body`}
        tabIndex={-1}
        onKeyDown={onCardKey}
        className="fixed z-[45] rounded-lg border border-border bg-popover text-popover-foreground shadow-raised outline-none"
        style={style}
      >
        <div className="border-b border-border px-4 py-3">
          <WorkflowLine stage={stageIndex} />
        </div>

        <div className="px-4 py-3.5" aria-live="polite">
          <h2 id={`${uid}-title`} className="text-base leading-6 font-semibold text-balance">
            {t(key('title'))}
          </h2>
          <p id={`${uid}-body`} className="mt-1 text-sm text-pretty text-muted-foreground">
            {t(key('body'))}
          </p>
          {missing && <p className="mt-2 text-xs text-muted-foreground">{t('tour.notVisible')}</p>}
          {!here && (
            <Button variant="outline" size="sm" className="mt-3" onClick={show}>
              {t('tour.showMe', { screen: t(`nav.${current.route.split('/')[2]}` as MessageKey) })} <ArrowRight aria-hidden />
            </Button>
          )}
          <Link
            href={`/dashboard/help#${current.doc}`}
            className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-info-text underline-offset-4 outline-none hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onClick={() => onStep(null)}
          >
            <BookOpen className="size-3.5" aria-hidden /> {t('tour.readMore')}
          </Link>
        </div>

        <div className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground" onClick={() => onStep(null)}>
            <X aria-hidden /> {t('tour.end')}
          </Button>
          <span className="flex-1" />
          <span className="mr-1 font-mono text-xs text-muted-foreground tabular-nums">
            <span aria-hidden>
              {step + 1} / {TOUR_STEPS.length}
            </span>
            <span className="sr-only">{t('tour.progress', { step: step + 1, total: TOUR_STEPS.length })}</span>
          </span>
          {step > 0 && (
            <Button variant="outline" size="sm" onClick={back}>
              <ArrowLeft aria-hidden /> {t('tour.back')}
            </Button>
          )}
          <Button size="sm" onClick={next}>
            {last ? (
              <>
                <Check aria-hidden /> {t('tour.finish')}
              </>
            ) : (
              <>
                {t('tour.next')} <ArrowRight aria-hidden />
              </>
            )}
          </Button>
        </div>
      </div>
    </>
  )
}

/**
 * The workflow as one line: a bus per stage, the stages passed live (closed,
 * solid), the line into the current stage energising, the rest open and dashed.
 * The current stage is named beside the drawing.
 */
function WorkflowLine({ stage }: { stage: number }) {
  const t = useT()
  return (
    <div className="flex items-center gap-3">
      <ol className="flex flex-1 items-center" aria-label={t('tour.workflow')}>
        {TOUR_STAGES.map((s: TourStage, i) => {
          const done = i < stage
          const now = i === stage
          return (
            <li key={s} className={cn('flex items-center', i > 0 && 'flex-1')} aria-current={now ? 'step' : undefined}>
              {i > 0 && (
                <span
                  aria-hidden
                  className={cn('h-0.5 flex-1', i < stage ? 'bg-live' : now ? 'flow-energise text-live' : 'bg-[repeating-linear-gradient(90deg,var(--paused)_0_5px,transparent_5px_9px)]')}
                />
              )}
              <span title={t(`tour.stages.${s}` as MessageKey)} className={cn('block size-2.5 shrink-0 rounded-[1px] border-2', done || now ? 'border-live bg-live' : 'border-paused')}>
                <span className="sr-only">
                  {t(`tour.stages.${s}` as MessageKey)}
                  {now ? ` (${t('tour.current')})` : done ? ` (${t('tour.done')})` : ''}
                </span>
              </span>
            </li>
          )
        })}
      </ol>
      <span aria-hidden className="shrink-0 text-xs font-medium text-live-text">
        {t(`tour.stages.${TOUR_STAGES[stage]}` as MessageKey)}
      </span>
    </div>
  )
}
