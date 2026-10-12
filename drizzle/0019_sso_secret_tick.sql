-- Scheduler tick also fires while SSO provider client secrets are stored in
-- plaintext (TD-25: the tick seals them with per-workspace keys). Same job as
-- 0017_scheduler_webhooks.sql plus that condition. No-op outside the pg_cron database.
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
             OR (status = 'cancelling' AND ("leaseUntil" IS NULL OR "leaseUntil" < now()))
        )
        OR EXISTS (
          SELECT 1 FROM public.dataset_policies
          WHERE "retentionDays" IS NOT NULL
            AND ("retentionAppliedAt" IS NULL OR "retentionAppliedAt" < now() - interval '1 hour')
        )
        OR EXISTS (SELECT 1 FROM public.webhook_deliveries WHERE status = 'pending' AND "nextAttemptAt" <= now())
        OR EXISTS (SELECT 1 FROM public.data_sources WHERE coalesce(credentials->>'__enc', '') <> 'v2')
        OR EXISTS (SELECT 1 FROM public."ssoProvider" WHERE "oidcConfig" LIKE '%"clientSecret"%')
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
    $job$
  );
END
$migration$;
