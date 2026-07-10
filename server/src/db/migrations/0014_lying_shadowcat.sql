ALTER TABLE "onboarding" ADD COLUMN "indexed_sha" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "files_indexed" integer;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "status" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "degraded" boolean;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "degraded_reason" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "cost_usd" double precision;