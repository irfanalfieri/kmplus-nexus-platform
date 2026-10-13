import { CronExpressionParser } from 'cron-parser'
import type { PipelineSchedule } from './definition'
import type { Translate } from '@/lib/i18n/translate'

/** Converts a schedule into a 5-field cron expression, or null for manual and "after another pipeline". */
export function scheduleToCron(schedule: PipelineSchedule): string | null {
  const [hh, mm] = schedule.time.split(':').map((n) => Number(n))
  switch (schedule.type) {
    case 'manual':
    case 'after':
      return null
    case 'hourly':
      return `${schedule.minute} * * * *`
    case 'daily':
      return `${mm} ${hh} * * *`
    case 'weekly':
      return `${mm} ${hh} * * ${(schedule.weekdays.length ? [...schedule.weekdays].sort() : [1]).join(',')}`
    case 'monthly':
      return `${mm} ${hh} ${schedule.dayOfMonth} * *`
    case 'cron':
      return schedule.cron.trim() || null
  }
}

/** Throws a readable error if the schedule can't produce run times. */
export function assertValidSchedule(schedule: PipelineSchedule) {
  if (schedule.type === 'after' && !schedule.afterPipelineId) throw new Error('Choose the pipeline this one runs after.')
  const expr = scheduleToCron(schedule)
  if (!expr) return
  try {
    CronExpressionParser.parse(expr, { tz: schedule.timezone }).next()
  } catch {
    throw new Error(`Invalid schedule "${expr}". Use 5 fields: minute hour day-of-month month day-of-week.`)
  }
}

export function nextRunTimes(schedule: PipelineSchedule, count = 1, from = new Date()): Date[] {
  const expr = scheduleToCron(schedule)
  if (!expr) return []
  try {
    const it = CronExpressionParser.parse(expr, { currentDate: from, tz: schedule.timezone })
    return Array.from({ length: count }, () => it.next().toDate())
  } catch {
    return []
  }
}

export function nextRunAt(schedule: PipelineSchedule, from = new Date()): Date | null {
  return nextRunTimes(schedule, 1, from)[0] ?? null
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

export function describeSchedule(schedule: PipelineSchedule): string {
  const tz = schedule.timezone === 'Asia/Jakarta' ? 'WIB' : schedule.timezone
  switch (schedule.type) {
    case 'manual':
      return 'Manual only'
    case 'hourly':
      return `Every hour at :${String(schedule.minute).padStart(2, '0')}`
    case 'daily':
      return `Every day at ${schedule.time} ${tz}`
    case 'weekly': {
      const days = [...schedule.weekdays].sort()
      const label = days.join(',') === '1,2,3,4,5' ? 'Weekdays' : days.map((d) => DAY_NAMES[d]).join(', ')
      return `${label} at ${schedule.time} ${tz}`
    }
    case 'monthly':
      return `Monthly on day ${schedule.dayOfMonth} at ${schedule.time} ${tz}`
    case 'cron':
      return `Cron "${schedule.cron}" (${tz})`
    case 'after':
      return `After another pipeline ${schedule.afterOn === 'any' ? 'finishes' : schedule.afterOn === 'success_or_partial' ? 'succeeds (also partially)' : 'succeeds'}`
  }
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

/** `describeSchedule` in the reader's language (the English one stays for the engine and server). */
export function describeScheduleT(schedule: PipelineSchedule, t: Translate): string {
  const tz = schedule.timezone === 'Asia/Jakarta' ? 'WIB' : schedule.timezone
  switch (schedule.type) {
    case 'manual':
      return t('editor.schedule.describe.manual')
    case 'hourly':
      return t('editor.schedule.describe.hourly', { minute: String(schedule.minute).padStart(2, '0') })
    case 'daily':
      return t('editor.schedule.describe.daily', { time: schedule.time, tz })
    case 'weekly': {
      const days = [...schedule.weekdays].sort()
      const label = days.join(',') === '1,2,3,4,5' ? t('editor.schedule.describe.weekdays') : days.map((d) => t(`editor.schedule.days.${DAY_KEYS[d] ?? 'sun'}`)).join(', ')
      return t('editor.schedule.describe.weekly', { days: label, time: schedule.time, tz })
    }
    case 'monthly':
      return t('editor.schedule.describe.monthly', { day: schedule.dayOfMonth, time: schedule.time, tz })
    case 'cron':
      return t('editor.schedule.describe.cron', { cron: schedule.cron, tz })
    case 'after':
      return t(schedule.afterOn === 'any' ? 'editor.schedule.describe.afterAny' : schedule.afterOn === 'success_or_partial' ? 'editor.schedule.describe.afterPartial' : 'editor.schedule.describe.afterSuccess')
  }
}

export function formatInTimezone(date: Date, timezone = 'Asia/Jakarta') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}
