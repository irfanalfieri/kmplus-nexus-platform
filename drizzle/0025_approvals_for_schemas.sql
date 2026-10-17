ALTER TABLE "pipeline_approvals" ALTER COLUMN "pipelineId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ADD COLUMN "subject" text DEFAULT 'pipeline' NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ADD COLUMN "payload" jsonb;