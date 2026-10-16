CREATE TABLE "api_call_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"pipelineId" text NOT NULL,
	"stepId" text NOT NULL,
	"value" jsonb NOT NULL,
	"notFound" boolean DEFAULT false NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_call_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"pipelineId" text NOT NULL,
	"stepId" text NOT NULL,
	"keyHash" text NOT NULL,
	"contentHash" text NOT NULL,
	"status" text DEFAULT 'done' NOT NULL,
	"answer" jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "api_call_cache_workspace_idx" ON "api_call_cache" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "api_call_cache_step_idx" ON "api_call_cache" USING btree ("pipelineId","stepId");--> statement-breakpoint
CREATE INDEX "api_call_cache_expires_idx" ON "api_call_cache" USING btree ("expiresAt");--> statement-breakpoint
CREATE INDEX "api_call_ledger_workspace_idx" ON "api_call_ledger" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "api_call_ledger_key_idx" ON "api_call_ledger" USING btree ("pipelineId","stepId","keyHash");--> statement-breakpoint
ALTER TABLE "api_call_cache" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_call_ledger" ENABLE ROW LEVEL SECURITY;
