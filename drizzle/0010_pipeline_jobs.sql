CREATE TABLE "pipeline_job_seen" (
	"jobId" text NOT NULL,
	"field" text NOT NULL,
	"hash" text NOT NULL,
	CONSTRAINT "pipeline_job_seen_jobId_field_hash_pk" PRIMARY KEY("jobId","field","hash")
);
--> statement-breakpoint
CREATE TABLE "pipeline_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"pipelineId" text NOT NULL,
	"actorId" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"availableAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseUntil" timestamp with time zone,
	"progress" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "pipeline_jobs_claim_idx" ON "pipeline_jobs" USING btree ("status","availableAt");--> statement-breakpoint
CREATE UNIQUE INDEX "pipeline_jobs_one_active_idx" ON "pipeline_jobs" USING btree ("pipelineId") WHERE "pipeline_jobs"."status" <> 'done';--> statement-breakpoint
-- Supabase exposes public through its REST API; RLS without policies blocks that.
ALTER TABLE "pipeline_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipeline_job_seen" ENABLE ROW LEVEL SECURITY;
