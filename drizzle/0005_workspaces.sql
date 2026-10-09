CREATE TABLE "workspace_invites" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"tokenHash" text NOT NULL,
	"invitedBy" text NOT NULL,
	"expiresAt" timestamp NOT NULL,
	"acceptedAt" timestamp,
	"acceptedBy" text,
	"revokedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invites_tokenHash_unique" UNIQUE("tokenHash")
);
--> statement-breakpoint
CREATE TABLE "workspace_members" (
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"role" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspaceId_userId_pk" PRIMARY KEY("workspaceId","userId")
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP INDEX "nexus_datasets_user_name_idx";--> statement-breakpoint
DROP INDEX "notifications_user_idx";--> statement-breakpoint
ALTER TABLE "audit_logs" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "connector_installs" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "execution_logs" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "nexus_datasets" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "pipeline_run_rejects" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ADD COLUMN "workspaceId" text;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "workspaceId" text;--> statement-breakpoint
-- Backfill: every existing user gets a personal workspace (id = 'ws_' || user id)
-- in which they are admin, and every existing row moves into its owner's workspace.
INSERT INTO "workspaces" ("id", "name", "createdBy")
  SELECT 'ws_' || u."id", coalesce(nullif(u."name", ''), split_part(u."email", '@', 1)) || '''s workspace', u."id" FROM "user" u
  ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "workspace_members" ("workspaceId", "userId", "role")
  SELECT 'ws_' || u."id", u."id", 'admin' FROM "user" u
  ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "audit_logs" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "connector_installs" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "data_sources" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "execution_logs" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "nexus_datasets" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "notifications" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "pipeline_run_rejects" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "pipeline_versions" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
UPDATE "pipelines" SET "workspaceId" = 'ws_' || "userId" WHERE "workspaceId" IS NULL;--> statement-breakpoint
ALTER TABLE "audit_logs" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "connector_installs" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "data_sources" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "execution_logs" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "nexus_datasets" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "notifications" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_run_rejects" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ALTER COLUMN "workspaceId" SET NOT NULL;--> statement-breakpoint
CREATE INDEX "workspace_invites_workspace_idx" ON "workspace_invites" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "workspace_members" USING btree ("userId");--> statement-breakpoint
CREATE UNIQUE INDEX "connector_installs_workspace_slug_idx" ON "connector_installs" USING btree ("workspaceId","connectorSlug");--> statement-breakpoint
CREATE INDEX "data_sources_workspace_idx" ON "data_sources" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "execution_logs_workspace_idx" ON "execution_logs" USING btree ("workspaceId","startTime");--> statement-breakpoint
CREATE UNIQUE INDEX "nexus_datasets_workspace_name_idx" ON "nexus_datasets" USING btree ("workspaceId","name");--> statement-breakpoint
CREATE INDEX "pipelines_workspace_idx" ON "pipelines" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("userId","workspaceId","createdAt");--> statement-breakpoint
ALTER TABLE "workspaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_invites" ENABLE ROW LEVEL SECURITY;
