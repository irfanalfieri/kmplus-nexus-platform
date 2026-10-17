CREATE TABLE "maintenance_windows" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"spec" jsonb NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "maintenance_windows_workspace_idx" ON "maintenance_windows" USING btree ("workspaceId");--> statement-breakpoint
ALTER TABLE "maintenance_windows" ENABLE ROW LEVEL SECURITY;
