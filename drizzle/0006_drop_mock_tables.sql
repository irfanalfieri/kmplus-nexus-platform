-- TD-12: unused tables from the original v0 mock-up (never read or written by the app).
-- No CASCADE: if anything depends on these tables, fail instead of dropping it.
DROP TABLE IF EXISTS "business_rules";--> statement-breakpoint
DROP TABLE IF EXISTS "connectors";--> statement-breakpoint
DROP TABLE IF EXISTS "dashboards";--> statement-breakpoint
DROP TABLE IF EXISTS "data_catalog";--> statement-breakpoint
DROP TABLE IF EXISTS "data_mappings";--> statement-breakpoint
DROP TABLE IF EXISTS "data_quality_metrics";--> statement-breakpoint
DROP TABLE IF EXISTS "governance_policies";--> statement-breakpoint
DROP TABLE IF EXISTS "integration_configs";--> statement-breakpoint
DROP TABLE IF EXISTS "pipeline_steps";