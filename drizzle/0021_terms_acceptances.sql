CREATE TABLE "terms_acceptances" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"version" text NOT NULL,
	"method" text NOT NULL,
	"locale" text,
	"ipAddress" text,
	"userAgent" text,
	"acceptedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "terms_acceptances_user_version_idx" ON "terms_acceptances" USING btree ("userId","version");
--> statement-breakpoint
ALTER TABLE "terms_acceptances" ENABLE ROW LEVEL SECURITY;
