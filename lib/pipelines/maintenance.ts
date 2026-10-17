import { z } from 'zod'

/**
 * Maintenance windows and blackout dates (SC-4). Pure and client-safe;
 * covered by scripts/engine-tests.ts.
 *
 * A window is a date range (blackout, e.g. year-end closing) or weekly hours
 * (e.g. Sunday 01:00–05:00 while the HRIS is patched), in WIB, for every
 * pipeline or some. Scheduled and chained runs that fall inside are either
 * deferred to the end of the window or skipped to their next scheduled time.
 * Manual, webhook and API runs are not held (the person or system asked).
 */

export const WINDOW_ACTIONS = ['defer', 'skip'] as const
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const
/** WIB is UTC+7 all year (no daylight saving). */
const WIB_OFFSET_MS = 7 * 3_600_000
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

export const maintenanceWindowSchema = z
  .object({
    name: z.string().trim().min(1, 'Name the window').max(80),
    kind: z.enum(['once', 'weekly']),
    /** once: WIB date-times "YYYY-MM-DDTHH:MM". */
    startsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
    endsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).optional(),
    /** weekly: days (0 = Sunday) and WIB hours; an end before the start runs past midnight. */
    days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
    startTime: z.string().regex(HHMM).optional(),
    endTime: z.string().regex(HHMM).optional(),
    action: z.enum(WINDOW_ACTIONS).default('defer'),
    /** Empty = every pipeline. */
    pipelineIds: z.array(z.string().min(1)).max(200).default([]),
  })
  .superRefine((w, ctx) => {
    if (w.kind === 'once') {
      if (!w.startsAt || !w.endsAt) ctx.addIssue({ code: 'custom', message: 'Choose when the window starts and ends' })
      else if (w.endsAt <= w.startsAt) ctx.addIssue({ code: 'custom', message: 'The window must end after it starts' })
    } else {
      if (!w.days.length) ctx.addIssue({ code: 'custom', message: 'Choose at least one day' })
      if (!w.startTime || !w.endTime) ctx.addIssue({ code: 'custom', message: 'Choose when the window starts and ends' })
      else if (w.startTime === w.endTime) ctx.addIssue({ code: 'custom', message: 'The window must end after it starts' })
    }
  })
export type MaintenanceWindow = z.infer<typeof maintenanceWindowSchema> & { id: string }

/** A WIB wall-clock "YYYY-MM-DDTHH:MM" as an instant. */
export const wibToDate = (local: string) => new Date(Date.parse(`${local}:00Z`) - WIB_OFFSET_MS)
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

/** When the window's occurrence containing `at` ends, or null when `at` is outside it. */
export function occurrenceEnd(w: MaintenanceWindow, at: Date): Date | null {
  if (w.kind === 'once') {
    const start = wibToDate(w.startsAt!)
    const end = wibToDate(w.endsAt!)
    return at >= start && at < end ? end : null
  }
  const local = new Date(at.getTime() + WIB_OFFSET_MS)
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes()
  const start = minutes(w.startTime!)
  const end = minutes(w.endTime!)
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) - WIB_OFFSET_MS
  const day = local.getUTCDay()
  if (start < end) {
    if (w.days.includes(day) && nowMin >= start && nowMin < end) return new Date(midnight + end * 60_000)
    return null
  }
  // Overnight (e.g. 22:00–04:00): today's part from the start, or yesterday's spilling into today.
  if (w.days.includes(day) && nowMin >= start) return new Date(midnight + (24 * 60 + end) * 60_000)
  if (w.days.includes((day + 6) % 7) && nowMin < end) return new Date(midnight + end * 60_000)
  return null
}

/** The window holding a pipeline's automatic runs at `at` (the latest-ending one when several overlap). */
export function activeWindow(windows: MaintenanceWindow[], pipelineId: string, at = new Date()): { window: MaintenanceWindow; endsAt: Date } | null {
  let found: { window: MaintenanceWindow; endsAt: Date } | null = null
  for (const w of windows) {
    if (w.pipelineIds.length && !w.pipelineIds.includes(pipelineId)) continue
    const end = occurrenceEnd(w, at)
    if (end && (!found || end > found.endsAt)) found = { window: w, endsAt: end }
  }
  // Back-to-back windows: keep going until no window holds the end time.
  if (found) {
    const next = activeWindow(windows.filter((w) => w !== found!.window), pipelineId, found.endsAt)
    if (next && next.endsAt > found.endsAt) return { window: found.window, endsAt: next.endsAt }
  }
  return found
}

/** What happens to an automatic run due at `at`: run, or wait until `until` (defer) / the next schedule after it (skip). */
export function holdRun(windows: MaintenanceWindow[], pipelineId: string, at = new Date()): { hold: false } | { hold: true; action: 'defer' | 'skip'; until: Date; window: string } {
  const active = activeWindow(windows, pipelineId, at)
  if (!active) return { hold: false }
  return { hold: true, action: active.window.action, until: active.endsAt, window: active.window.name }
}
