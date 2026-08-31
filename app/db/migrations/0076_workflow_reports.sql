-- ─────────────────────────────────────────────────────────────────────────────
-- 0076 — Workflow Reports.
--
-- Hand-written, not `drizzle-kit generate` output, for the same reason 0075
-- is: `app/db/migrations/meta/` stops at 0030_snapshot.json while the journal
-- and this folder run ahead of it, so `drizzle-kit generate` cannot diff
-- against a trustworthy current state. This file is written to match exactly
-- what Drizzle would emit for `app/db/schema/workflowReports.ts` — same
-- column/constraint naming, same RLS and grant boilerplate as 0070/0075 — so a
-- future `drizzle-kit generate`, once the snapshot chain is repaired, produces
-- no further diff against it.
--
-- One table, company/project-scoped like `project_instructions`. Numbered
-- through the shared `next_entry_number(company_id, prefix)` function from
-- 0001 — 'WFR' needs no separate registration, the function creates the
-- counter row on first use.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."workflow_report_type" AS ENUM(
  'progress', 'inspection', 'service', 'incident', 'handover'
);--> statement-breakpoint

CREATE TYPE "public"."workflow_report_status" AS ENUM(
  'draft', 'submitted', 'reviewed', 'approved'
);--> statement-breakpoint

CREATE TABLE "workflow_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	"report_number" text NOT NULL,
	"type" "workflow_report_type" DEFAULT 'progress' NOT NULL,
	"title" text NOT NULL,

	"period_start" date,
	"period_end" date,

	"summary" text NOT NULL,
	"work_completed" text DEFAULT '' NOT NULL,
	"issues" text DEFAULT '' NOT NULL,
	"next_steps" text DEFAULT '' NOT NULL,

	"status" "workflow_report_status" DEFAULT 'draft' NOT NULL,

	-- The project figures as they stood when the report was submitted. Null
	-- until first submission; copied, not joined, so an approved report keeps
	-- agreeing with itself after the project's live numbers move on.
	"snapshot_progress" integer,
	"snapshot_revenue" numeric(19, 4),
	"snapshot_cost" numeric(19, 4),
	"submitted_by_name" text,
	"submitted_at" timestamp with time zone,

	"reviewed_by_id" text,
	"reviewed_by_name" text,
	"reviewed_at" timestamp with time zone,

	"approved_by_id" text,
	"approved_by_name" text,
	"approved_at" timestamp with time zone,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "workflow_reports_title_not_blank" CHECK (
		length(btrim("title")) > 0
	),
	CONSTRAINT "workflow_reports_summary_not_blank" CHECK (
		length(btrim("summary")) > 0
	),
	CONSTRAINT "workflow_reports_period_ordered" CHECK (
		"period_start" IS NULL OR "period_end" IS NULL OR "period_start" <= "period_end"
	),
	CONSTRAINT "workflow_reports_progress_range" CHECK (
		"snapshot_progress" IS NULL
		OR ("snapshot_progress" >= 0 AND "snapshot_progress" <= 100)
	),
	-- A status flip with nobody attached to it is a checkbox, not a decision.
	CONSTRAINT "workflow_reports_submission_signed" CHECK (
		"status" = 'draft'
		OR ("submitted_by_name" IS NOT NULL AND "submitted_at" IS NOT NULL)
	),
	CONSTRAINT "workflow_reports_review_signed" CHECK (
		"status" IN ('draft', 'submitted')
		OR ("reviewed_by_name" IS NOT NULL AND "reviewed_at" IS NOT NULL)
	),
	CONSTRAINT "workflow_reports_approval_signed" CHECK (
		"status" <> 'approved'
		OR ("approved_by_name" IS NOT NULL AND "approved_at" IS NOT NULL)
	)
);
--> statement-breakpoint

ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_reviewed_by_id_users_id_fk" FOREIGN KEY ("reviewed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_reports" ADD CONSTRAINT "workflow_reports_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "workflow_reports_company_number_idx" ON "workflow_reports" USING btree ("company_id","report_number");--> statement-breakpoint
CREATE INDEX "workflow_reports_project_idx" ON "workflow_reports" USING btree ("company_id","project_id","created_at");--> statement-breakpoint
CREATE INDEX "workflow_reports_status_idx" ON "workflow_reports" USING btree ("company_id","project_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security. Same tenant_isolation policy as every other
-- company-scoped table since 0001.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "workflow_reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "workflow_reports" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workflow_reports"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "workflow_reports" TO app_user;
