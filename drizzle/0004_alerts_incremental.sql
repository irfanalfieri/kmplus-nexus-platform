CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"level" text NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"pipelineId" text,
	"runId" text,
	"emailStatus" text,
	"readAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "state" jsonb;--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("userId","createdAt");--> statement-breakpoint
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;