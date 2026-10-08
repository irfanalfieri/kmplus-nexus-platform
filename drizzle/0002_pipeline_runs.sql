CREATE TABLE "nexus_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"name" text NOT NULL,
	"tableName" text NOT NULL,
	"columns" jsonb NOT NULL,
	"pipelineId" text,
	"rowCount" integer DEFAULT 0,
	"lastLoadedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "nexus_datasets_tableName_unique" UNIQUE("tableName")
);
--> statement-breakpoint
CREATE TABLE "pipeline_run_rejects" (
	"id" text PRIMARY KEY NOT NULL,
	"runId" text NOT NULL,
	"pipelineId" text NOT NULL,
	"userId" text NOT NULL,
	"row" jsonb NOT NULL,
	"errors" jsonb NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "execution_logs" ADD COLUMN "trigger" text;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD COLUMN "pipelineVersion" integer;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "lastRunAt" timestamp;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "lastRunStatus" text;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "nextRunAt" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "nexus_datasets_user_name_idx" ON "nexus_datasets" USING btree ("userId","name");--> statement-breakpoint
CREATE INDEX "pipeline_run_rejects_run_idx" ON "pipeline_run_rejects" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "execution_logs_pipeline_idx" ON "execution_logs" USING btree ("pipelineId","createdAt");--> statement-breakpoint
CREATE INDEX "pipelines_next_run_idx" ON "pipelines" USING btree ("nextRunAt");--> statement-breakpoint
ALTER TABLE "pipeline_run_rejects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nexus_datasets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Physical storage for Nexus datasets. Not in Supabase's exposed API schemas;
-- revoke defaults so only the app's owner role can touch it.
CREATE SCHEMA IF NOT EXISTS "nexus_data";--> statement-breakpoint
REVOKE ALL ON SCHEMA "nexus_data" FROM PUBLIC;--> statement-breakpoint
REVOKE ALL ON SCHEMA "nexus_data" FROM anon, authenticated;
