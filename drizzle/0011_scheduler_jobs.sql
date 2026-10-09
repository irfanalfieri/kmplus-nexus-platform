-- Scheduler tick also fires while background jobs are waiting (TD-5): queued
-- jobs whose backoff has passed, and running jobs whose lease expired (a run
-- that outgrew one 300 s function, or crashed). Same job name as
-- 0003_pipeline_scheduler.sql, which this replaces. No-op outside the pg_cron
-- database (nexus_dev has no scheduler).
DO $migration$
BEGIN
  IF current_database() <> coalesce(current_setting('cron.database_name', true), 'postgres') THEN
    RAISE NOTICE 'Skipping pipeline scheduler: % is not the pg_cron database', current_database();
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nexus-pipeline-tick';
  PERFORM cron.schedule(
    'nexus-pipeline-tick',
    '* * * * *',
    $job$
    SELECT net.http_post(
      url := 'https://kmplus-nexus-platform.vercel.app/api/cron/pipelines',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 300000
    )
    WHERE (
        EXISTS (SELECT 1 FROM public.pipelines WHERE enabled AND "nextRunAt" <= now())
        OR EXISTS (
          SELECT 1 FROM public.pipeline_jobs
          WHERE (status = 'queued' AND "availableAt" <= now())
             OR (status = 'running' AND "leaseUntil" < now())
        )
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
    $job$
  );
END
$migration$;
