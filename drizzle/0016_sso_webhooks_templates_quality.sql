CREATE TABLE "api_rate_limits" (
	"bucket" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "api_rate_limits_bucket_windowStart_pk" PRIMARY KEY("bucket","windowStart")
);
--> statement-breakpoint
CREATE TABLE "dataset_quality_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"datasetName" text NOT NULL,
	"day" text NOT NULL,
	"rowCount" integer DEFAULT 0 NOT NULL,
	"completeness" numeric,
	"uniqueness" numeric,
	"validity" numeric,
	"freshnessHours" numeric,
	"score" numeric,
	"takenAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapping_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"fields" jsonb NOT NULL,
	"keepUnmapped" boolean DEFAULT false NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ssoProvider" (
	"id" text PRIMARY KEY NOT NULL,
	"issuer" text NOT NULL,
	"oidcConfig" text,
	"samlConfig" text,
	"userId" text,
	"providerId" text NOT NULL,
	"organizationId" text,
	"domain" text NOT NULL,
	"domainVerified" boolean DEFAULT false,
	CONSTRAINT "ssoProvider_providerId_unique" UNIQUE("providerId")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"webhookId" text NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"responseStatus" integer,
	"error" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deliveredAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_sso" (
	"id" text PRIMARY KEY NOT NULL,
	"workspaceId" text NOT NULL,
	"providerId" text NOT NULL,
	"label" text NOT NULL,
	"preset" text NOT NULL,
	"domain" text NOT NULL,
	"defaultRole" text DEFAULT 'viewer' NOT NULL,
	"enforce" boolean DEFAULT false NOT NULL,
	"verificationToken" text NOT NULL,
	"verifiedAt" timestamp with time zone,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_sso_providerId_unique" UNIQUE("providerId")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN "rateLimitPerMinute" integer DEFAULT 120 NOT NULL;--> statement-breakpoint
ALTER TABLE "pipelines" ADD COLUMN "triggerTokenHash" text;--> statement-breakpoint
ALTER TABLE "session" ADD COLUMN "authMethod" text;--> statement-breakpoint
CREATE UNIQUE INDEX "dataset_quality_day_idx" ON "dataset_quality_snapshots" USING btree ("workspaceId","datasetName","day");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_templates_workspace_name_idx" ON "mapping_templates" USING btree ("workspaceId","name");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("status","nextAttemptAt");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_webhook_idx" ON "webhook_deliveries" USING btree ("webhookId","createdAt");--> statement-breakpoint
CREATE INDEX "webhooks_workspace_idx" ON "webhooks" USING btree ("workspaceId");--> statement-breakpoint
CREATE INDEX "workspace_sso_workspace_idx" ON "workspace_sso" USING btree ("workspaceId");--> statement-breakpoint
ALTER TABLE "ssoProvider" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workspace_sso" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "api_rate_limits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mapping_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dataset_quality_snapshots" ENABLE ROW LEVEL SECURITY;
