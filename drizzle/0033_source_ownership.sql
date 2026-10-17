ALTER TABLE "data_sources" ADD COLUMN "ownerId" text;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "tags" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
-- DS-11: existing sources are owned by the person who added them.
UPDATE "data_sources" SET "ownerId" = "userId" WHERE "ownerId" IS NULL;
