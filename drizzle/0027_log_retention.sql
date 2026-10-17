ALTER TABLE "workspaces" ADD COLUMN "logDetailDays" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "runSummaryDays" integer DEFAULT 365 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "logsPrunedAt" timestamp with time zone;--> statement-breakpoint
-- Scheduler tick also fires when a workspace's run logs are due for pruning (MN-7, hourly).
-- Same job as 0026_source_health.sql plus that condition. No-op outside the pg_cron database.
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
        OR EXISTS (SELECT 1 FROM public.data_sources WHERE "healthCheckMinutes" > 0 AND "nextHealthCheckAt" <= now())
        OR EXISTS (SELECT 1 FROM public.workspaces WHERE "logsPrunedAt" IS NULL OR "logsPrunedAt" < now() - interval '1 hour')
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
    $job$
  );
END
$migration$;
