CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"widgets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"datasetName" text NOT NULL,
	"columns" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"retentionDays" integer,
	"retentionAppliedAt" timestamp with time zone,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "dashboards_workspace_idx" ON "dashboards" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_policies_workspace_dataset_idx" ON "dataset_policies" USING btree ("workspaceId","datasetName");--> statement-breakpoint
-- Supabase exposes public through its REST API; RLS without policies blocks that.
ALTER TABLE "dataset_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;
