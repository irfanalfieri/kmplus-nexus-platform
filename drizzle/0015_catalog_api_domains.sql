CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"role" text DEFAULT 'analyst' NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lastUsedAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"revokedBy" text,
	CONSTRAINT "api_keys_hash_unique" UNIQUE("hash")
);
--> statement-breakpoint
CREATE TABLE "catalog_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"key" text NOT NULL,
	"kind" text NOT NULL,
	"datasetName" text,
	"dataSourceId" text,
	"tableName" text,
	"description" text,
	"ownerId" text,
	"stewardId" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"classification" text DEFAULT 'internal' NOT NULL,
	"columnDocs" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"accessMode" text DEFAULT 'live' NOT NULL,
	"alias" text,
	"refresh" text DEFAULT 'daily' NOT NULL,
	"refreshAfterPipelineId" text,
	"cachePipelineId" text,
	"liveRowLimit" integer DEFAULT 1000 NOT NULL,
	"liveTimeoutSeconds" integer DEFAULT 30 NOT NULL,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "domain_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"entity" text NOT NULL,
	"datasetName" text NOT NULL,
	"fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updatedBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dataset_policies" ADD COLUMN "rowFilters" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
CREATE INDEX "api_keys_workspace_idx" ON "api_keys" USING btree ("workspaceId");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entries_workspace_key_idx" ON "catalog_entries" USING btree ("workspaceId","key");--> statement-breakpoint
CREATE UNIQUE INDEX "catalog_entries_workspace_alias_idx" ON "catalog_entries" USING btree ("workspaceId","alias");--> statement-breakpoint
CREATE UNIQUE INDEX "domain_mappings_workspace_entity_idx" ON "domain_mappings" USING btree ("workspaceId","entity");--> statement-breakpoint
ALTER TABLE "catalog_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "domain_mappings" ENABLE ROW LEVEL SECURITY;
