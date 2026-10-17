CREATE TABLE "pipeline_trigger_events" (
	"pipelineId" text NOT NULL,
	"eventId" text NOT NULL,
	"workspaceId" text NOT NULL,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pipeline_trigger_events_pipelineId_eventId_pk" PRIMARY KEY("pipelineId","eventId")
);
--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "triggerConfig" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "eventPendingAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "pipeline_trigger_events_received_idx" ON "pipeline_trigger_events" USING btree ("receivedAt");--> statement-breakpoint
CREATE INDEX "pipeline_trigger_events_workspace_idx" ON "pipeline_trigger_events" USING btree ("workspaceId");ALTER TABLE "pipeline_trigger_events" ENABLE ROW LEVEL SECURITY;
