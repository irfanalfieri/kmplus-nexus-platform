-- Supabase exposes the public schema through its Data API (PostgREST).
-- Enable RLS with no policies so anon/authenticated API keys cannot read or
-- write any Nexus table. The app connects as the database owner (postgres),
-- which bypasses RLS, so app queries are unaffected.
ALTER TABLE "account" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "business_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connector_installs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connectors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "dashboards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_catalog" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_mappings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_quality_metrics" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "data_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "execution_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "governance_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "integration_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipeline_steps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipeline_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pipelines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "verification" ENABLE ROW LEVEL SECURITY;
