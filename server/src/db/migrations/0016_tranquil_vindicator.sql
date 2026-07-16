CREATE TABLE "eval_case_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" uuid,
	"case_name" text NOT NULL,
	"input_fingerprint" text NOT NULL,
	"outcome" text NOT NULL,
	"error" text,
	"expected_count" integer,
	"matched_count" integer,
	"emitted_count" integer,
	"kept_count" integer,
	"findings" jsonb,
	"unmatched_findings" jsonb,
	"duration_ms" integer,
	"cost_usd" double precision
);
--> statement-breakpoint
CREATE TABLE "eval_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL,
	"effective_config" jsonb,
	"input_fingerprint" text,
	"outcome" text,
	"error" text,
	"expected_count" integer,
	"matched_count" integer,
	"emitted_count" integer,
	"kept_count" integer,
	"findings" jsonb,
	"duration_ms" integer,
	"cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "eval_runs" DROP CONSTRAINT "eval_runs_case_id_eval_cases_id_fk";
--> statement-breakpoint
ALTER TABLE "eval_cases" ALTER COLUMN "input_diff" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "expectation" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "source_finding" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "forbidden_region" jsonb;--> statement-breakpoint
ALTER TABLE "eval_cases" ADD COLUMN "input_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "workspace_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "agent_version" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "effective_config" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "status" text NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "started_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "finished_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_total" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "cases_done" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "errored_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "traces_passed" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "traces_total" integer;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "error" text;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_run_id_eval_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."eval_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_case_results" ADD CONSTRAINT "eval_case_results_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_drafts" ADD CONSTRAINT "eval_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_drafts" ADD CONSTRAINT "eval_drafts_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_drafts" ADD CONSTRAINT "eval_drafts_case_id_eval_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."eval_cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_drafts_case_running_uq" ON "eval_drafts" USING btree ("case_id") WHERE "eval_drafts"."status" = 'running';--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_findings_id_fk" FOREIGN KEY ("source_finding_id") REFERENCES "public"."findings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_cases_owner_idx" ON "eval_cases" USING btree ("owner_kind","owner_id");--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "case_id";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "ran_at";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "actual_output";--> statement-breakpoint
ALTER TABLE "eval_runs" DROP COLUMN "pass";--> statement-breakpoint
ALTER TABLE "eval_cases" ADD CONSTRAINT "eval_cases_source_finding_id_unique" UNIQUE("source_finding_id");