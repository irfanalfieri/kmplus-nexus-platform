CREATE TABLE "dataset_column_aliases" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"datasetName" text NOT NULL,
	"oldName" text NOT NULL,
	"newName" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_schema_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"schemaId" text NOT NULL,
	"datasetName" text NOT NULL,
	"version" integer NOT NULL,
	"columns" jsonb NOT NULL,
	"keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"autoAdd" boolean DEFAULT false NOT NULL,
	"change" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"changedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dataset_schemas" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"datasetName" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"columns" jsonb NOT NULL,
	"keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"autoAdd" boolean DEFAULT false NOT NULL,
	"createdBy" text NOT NULL,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upgrade_notice_dismissals" (
	"workspaceId" text NOT NULL,
	"userId" text NOT NULL,
	"noticeId" text NOT NULL,
	"dismissedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upgrade_notice_dismissals_workspaceId_userId_noticeId_pk" PRIMARY KEY("workspaceId","userId","noticeId")
);
--> statement-breakpoint
ALTER TABLE "nexus_datasets" ADD COLUMN "defined" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nexus_datasets" ADD COLUMN "schemaId" text;--> statement-breakpoint
CREATE INDEX "dataset_column_aliases_dataset_idx" ON "dataset_column_aliases" USING btree ("workspaceId","datasetName");--> statement-breakpoint
CREATE INDEX "dataset_schema_versions_workspace_idx" ON "dataset_schema_versions" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "dataset_schema_versions_schema_idx" ON "dataset_schema_versions" USING btree ("schemaId","version");--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_schemas_workspace_dataset_idx" ON "dataset_schemas" USING btree ("workspaceId","datasetName");--> statement-breakpoint
CREATE INDEX "upgrade_notice_dismissals_workspace_idx" ON "upgrade_notice_dismissals" USING btree ("workspaceId");--> statement-breakpoint
ALTER TABLE "dataset_schemas" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dataset_schema_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dataset_column_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "upgrade_notice_dismissals" ENABLE ROW LEVEL SECURITY;
