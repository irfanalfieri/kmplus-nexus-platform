import { after } from 'next/server'
import { hasRunnableJobs, processJobs, WORKER_BUDGET_MS } from './jobs'

/**
 * Starts a background worker after the current response is sent (server
 * actions and route handlers only). It picks up any runnable job; extra
 * workers are harmless because jobs are claimed with FOR UPDATE SKIP LOCKED.
 */
export function startWorker() {
  after(async () => {
    try {
      await processJobs({ budgetMs: WORKER_BUDGET_MS })
    } catch (err) {
      console.error('[worker] failed:', err instanceof Error ? err.message : err)
    }
  })
}

/**
 * Starts a worker if a job of this workspace is waiting. Pages that show run
 * progress call this, so runs advance even without the scheduler (development
 * and preview deployments have no pg_cron).
 */
export async function nudgeWorker(workspaceId: string) {
  if (await hasRunnableJobs(workspaceId)) startWorker()
}
