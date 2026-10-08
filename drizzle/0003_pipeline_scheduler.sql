-- Pipeline scheduler: every minute, if any enabled pipeline is due, POST to the
-- app's scheduler endpoint. The bearer secret lives in Supabase Vault under
-- 'nexus_cron_secret' (same value as the CRON_SECRET env var on Vercel); it is
-- set outside migrations so it never lands in git.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;--> statement-breakpoint
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'nexus-pipeline-tick';--> statement-breakpoint
SELECT cron.schedule(
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
  WHERE EXISTS (SELECT 1 FROM public.pipelines WHERE enabled AND "nextRunAt" <= now())
    AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'nexus_cron_secret');
  $job$
);
