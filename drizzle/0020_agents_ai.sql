CREATE TABLE "agent_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"agentId" text NOT NULL,
	"op" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"result" jsonb,
	"error" text,
	"retryable" boolean,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"claimedAt" timestamp with time zone,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"tokenHash" text NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastSeenAt" timestamp with time zone,
	"version" text,
	"hostname" text,
	"connections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ai" jsonb,
	"revokedAt" timestamp with time zone,
	"revokedBy" text,
	CONSTRAINT "agents_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "aiProvider" text DEFAULT 'server' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "aiAgentId" text;--> statement-breakpoint
CREATE INDEX "agent_tasks_queue_idx" ON "agent_tasks" USING btree ("agentId","status","createdAt");--> statement-breakpoint
CREATE INDEX "agents_workspace_idx" ON "agents" USING btree ("workspaceId");--> statement-breakpoint
ALTER TABLE "agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_tasks" ENABLE ROW LEVEL SECURITY;
