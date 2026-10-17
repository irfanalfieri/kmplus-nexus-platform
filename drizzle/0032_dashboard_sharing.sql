CREATE TABLE "dashboard_embeds" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"dashboardId" text NOT NULL,
	"tokenHash" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"allowedOrigins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expiresAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"lastUsedAt" timestamp with time zone,
	"views" integer DEFAULT 0 NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dashboards" ADD COLUMN "sharing" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "dashboard_embeds_token_idx" ON "dashboard_embeds" USING btree ("tokenHash");--> statement-breakpoint
CREATE INDEX "dashboard_embeds_workspace_idx" ON "dashboard_embeds" USING btree ("workspaceId","dashboardId");--> statement-breakpoint
ALTER TABLE "dashboard_embeds" ENABLE ROW LEVEL SECURITY;
