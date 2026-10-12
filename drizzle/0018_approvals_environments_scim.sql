CREATE TABLE "pipeline_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"pipelineId" text NOT NULL,
	"version" integer NOT NULL,
	"kind" text DEFAULT 'publish' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled" boolean,
	"requestNote" text,
	"requestedBy" text NOT NULL,
	"fromWorkspaceId" text,
	"decidedBy" text,
	"decisionNote" text,
	"decidedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"displayName" text NOT NULL,
	"externalId" text,
	"role" text,
	"members" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scim_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"revokedBy" text,
	CONSTRAINT "scim_tokens_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "scim_users" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"userName" text NOT NULL,
	"externalId" text,
	"active" boolean DEFAULT true NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "promotionKey" text;--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD COLUMN "protocol" text DEFAULT 'oidc' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_sso" ADD COLUMN "jitProvisioning" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "publishApproval" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "environment" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "environmentGroupId" text;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "environmentLocked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "pipeline_approvals_inbox_idx" ON "pipeline_approvals" USING btree ("workspaceId","status","createdAt");--> statement-breakpoint
CREATE INDEX "pipeline_approvals_pipeline_idx" ON "pipeline_approvals" USING btree ("pipelineId");--> statement-breakpoint
CREATE INDEX "scim_groups_workspace_idx" ON "scim_groups" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "scim_tokens_workspace_idx" ON "scim_tokens" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "scim_users_member_idx" ON "scim_users" USING btree ("workspaceId","userId");--> statement-breakpoint
CREATE INDEX "scim_users_name_idx" ON "scim_users" USING btree ("workspaceId","userName");--> statement-breakpoint
CREATE INDEX "pipelines_promotion_idx" ON "pipelines" USING btree ("workspaceId","promotionKey");--> statement-breakpoint
ALTER TABLE "pipeline_approvals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scim_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scim_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scim_users" ENABLE ROW LEVEL SECURITY;
