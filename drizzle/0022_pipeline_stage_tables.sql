CREATE TABLE "pipeline_stage_tables" (
	"tableName" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"runId" text NOT NULL,
	"nodeId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pipeline_stage_tables_workspace_idx" ON "pipeline_stage_tables" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "pipeline_stage_tables_run_idx" ON "pipeline_stage_tables" USING btree ("runId");--> statement-breakpoint
CREATE INDEX "pipeline_stage_tables_created_idx" ON "pipeline_stage_tables" USING btree ("createdAt");--> statement-breakpoint
ALTER TABLE "pipeline_stage_tables" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Run staging tables (a Join's right side). Not exposed through Supabase's Data API (only "public" is).
CREATE SCHEMA IF NOT EXISTS "nexus_stage";
