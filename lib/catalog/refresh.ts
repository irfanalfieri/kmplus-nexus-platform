import { scheduleSchema, type PipelineSchedule } from '@/lib/pipelines/definition'

/** Cache refresh options (DV-2). Client-safe; lib/pipelines/managed.ts turns them into schedules. */
export const CACHE_REFRESH_OPTIONS = ['manual', '5m', '15m', 'hourly', 'daily', 'after_pipeline'] as const
export type CacheRefreshOption = (typeof CACHE_REFRESH_OPTIONS)[number]

export const CACHE_REFRESH_LABELS: Record<CacheRefreshOption, string> = {
  manual: 'Only when I refresh it',
  '5m': 'Every 5 minutes',
  '15m': 'Every 15 minutes',
  hourly: 'Hourly',
  daily: 'Daily at 02:00 WIB',
  after_pipeline: 'After a pipeline finishes',
}

/** The managed pipeline's schedule for a refresh option. */
export function refreshSchedule(refresh: CacheRefreshOption, afterPipelineId?: string | null): PipelineSchedule {
  switch (refresh) {
    case 'after_pipeline':
      // A copy is worth refreshing even when the upstream run quarantined some rows.
      return afterPipelineId ? scheduleSchema.parse({ type: 'after', afterPipelineId, afterOn: 'success_or_partial' }) : scheduleSchema.parse({ type: 'manual' })
    case '5m':
      return scheduleSchema.parse({ type: 'cron', cron: '*/5 * * * *' })
    case '15m':
      return scheduleSchema.parse({ type: 'cron', cron: '*/15 * * * *' })
    case 'hourly':
      return scheduleSchema.parse({ type: 'hourly', minute: 0 })
    case 'daily':
      return scheduleSchema.parse({ type: 'daily', time: '02:00' })
    default:
      return scheduleSchema.parse({ type: 'manual' })
  }
}

