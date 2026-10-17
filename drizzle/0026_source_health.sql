CREATE TABLE "source_health_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"dataSourceId" text NOT NULL,
	"checkedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"ok" boolean NOT NULL,
	"latencyMs" integer,
	"message" text,
	"trigger" text DEFAULT 'schedule' NOT NULL,
	"scanned" boolean DEFAULT false NOT NULL,
	"drift" jsonb
);
--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "healthCheckMinutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "nextHealthCheckAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "lastHealthCheckAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "healthFailures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "schemaDrift" jsonb;--> statement-breakpoint
CREATE INDEX "source_health_checks_source_idx" ON "source_health_checks" USING btree ("dataSourceId","checkedAt");--> statement-breakpoint
CREATE INDEX "source_health_checks_workspace_idx" ON "source_health_checks" USING btree ("workspaceId","checkedAt");--> statement-breakpoint
CREATE INDEX "data_sources_health_due_idx" ON "data_sources" USING btree ("nextHealthCheckAt");--> statement-breakpoint
ALTER TABLE "source_health_checks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- File uploads have nothing to reach; every other source is checked, first checks spread over 15 minutes.
UPDATE "data_sources" SET "healthCheckMinutes" = 0 WHERE "sourceType" = 'file';--> statement-breakpoint
UPDATE "data_sources" SET "nextHealthCheckAt" = now() + (random() * interval '15 minutes') WHERE "sourceType" <> 'file';--> statement-breakpoint
-- Scheduler tick also fires when a data source health check is due (DS-7). Same job as
-- 0019_sso_secret_tick.sql plus that condition. No-op outside the pg_cron database.
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
      )
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
    $job$
  );
END
$migration$;
