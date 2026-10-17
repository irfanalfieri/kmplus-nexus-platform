CREATE TABLE "alert_channels" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"secret" jsonb NOT NULL,
	"allPipelines" boolean DEFAULT false NOT NULL,
	"lastStatus" text,
	"lastError" text,
	"lastSentAt" timestamp with time zone,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pipeline_alerts" (
	"pipelineId" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"config" jsonb NOT NULL,
	"state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"nextCheckAt" timestamp with time zone,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "alert_channels_workspace_idx" ON "alert_channels" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "pipeline_alerts_workspace_idx" ON "pipeline_alerts" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "pipeline_alerts_check_idx" ON "pipeline_alerts" USING btree ("nextCheckAt");;--> statement-breakpoint
ALTER TABLE "alert_channels" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipeline_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Scheduler tick also fires when a pipeline's SLA alerts are due for a check (MN-5).
-- Same job as 0027_log_retention.sql plus that condition. No-op outside the pg_cron database.
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
        OR EXISTS (SELECT 1 FROM public.pipeline_alerts WHERE "nextCheckAt" <= now())
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
    $job$
  );
END
$migration$;
