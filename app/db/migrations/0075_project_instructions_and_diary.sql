-- ─────────────────────────────────────────────────────────────────────────────
-- 0075 — Engineer's Instructions & Site Diary.
--
-- Hand-written, not `drizzle-kit generate` output. `app/db/migrations/meta/`
-- stops at 0030_snapshot.json while the journal and this folder both go to
-- 0074 — the snapshot chain has been out of sync with the real migration
-- history since well before this change, so `drizzle-kit generate` cannot
-- diff against a trustworthy "current state" and fails with a snapshot
-- collision before it ever looks at this migration's schema. This file is
-- written to match exactly what Drizzle would emit for
-- `app/db/schema/projectLogs.ts` — same column/constraint naming, same RLS
-- and grant boilerplate as 0070/0071 — so a future `drizzle-kit generate`,
-- once the snapshot chain is repaired, produces no further diff against it.
--
-- Two tables, both company/project-scoped like `project_tasks`. Numbered
-- through the shared `next_entry_number(company_id, prefix)` function from
-- 0001 — 'EI' and 'CSD' need no separate registration, the function creates
-- the counter row on first use.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."project_instruction_type" AS ENUM(
  'instruction', 'ncr', 'vo', 'rfi_response'
);--> statement-breakpoint

CREATE TYPE "public"."project_instruction_status" AS ENUM(
  'pending', 'complied', 'disputed'
);--> statement-breakpoint

CREATE TYPE "public"."project_diary_status" AS ENUM(
  'submitted', 'countersigned'
);--> statement-breakpoint

CREATE TABLE "project_instructions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	"instruction_number" text NOT NULL,
	"type" "project_instruction_type" DEFAULT 'instruction' NOT NULL,
	"clause_reference" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"description" text NOT NULL,
	"estimated_cost" numeric(19, 4),

	"issued_date" date NOT NULL,
	"issued_by_name" text NOT NULL,

	"status" "project_instruction_status" DEFAULT 'pending' NOT NULL,
	"response_notes" text,
	"responded_by_id" text,
	"responded_by_name" text,
	"responded_at" timestamp with time zone,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_instructions_description_not_blank" CHECK (
		length(btrim("description")) > 0
	),
	CONSTRAINT "project_instructions_issued_by_not_blank" CHECK (
		length(btrim("issued_by_name")) > 0
	),
	CONSTRAINT "project_instructions_cost_non_negative" CHECK (
		"estimated_cost" IS NULL OR "estimated_cost" >= 0
	),
	-- A status flip with nobody attached to it is a checkbox, not a decision.
	CONSTRAINT "project_instructions_response_signed" CHECK (
		"status" = 'pending'
		OR ("responded_by_name" IS NOT NULL AND "responded_at" IS NOT NULL)
	)
);
--> statement-breakpoint

CREATE TABLE "project_diary_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,

	"entry_number" text NOT NULL,
	"diary_date" date NOT NULL,
	"weather" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"activities" text NOT NULL,
	"plant" text DEFAULT '' NOT NULL,
	"manpower_count" integer DEFAULT 0 NOT NULL,
	"incident_count" integer DEFAULT 0 NOT NULL,
	"incident_notes" text DEFAULT '' NOT NULL,

	"logged_by_name" text NOT NULL,

	"status" "project_diary_status" DEFAULT 'submitted' NOT NULL,
	"countersigned_by_id" text,
	"countersigned_by_name" text,
	"countersigned_at" timestamp with time zone,

	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "project_diary_activities_not_blank" CHECK (
		length(btrim("activities")) > 0
	),
	CONSTRAINT "project_diary_logged_by_not_blank" CHECK (
		length(btrim("logged_by_name")) > 0
	),
	CONSTRAINT "project_diary_manpower_non_negative" CHECK ("manpower_count" >= 0),
	CONSTRAINT "project_diary_incidents_non_negative" CHECK ("incident_count" >= 0),
	CONSTRAINT "project_diary_countersign_signed" CHECK (
		"status" = 'submitted'
		OR ("countersigned_by_name" IS NOT NULL AND "countersigned_at" IS NOT NULL)
	)
);
--> statement-breakpoint

ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_responded_by_id_users_id_fk" FOREIGN KEY ("responded_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_instructions" ADD CONSTRAINT "project_instructions_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "project_diary_entries" ADD CONSTRAINT "project_diary_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_diary_entries" ADD CONSTRAINT "project_diary_entries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_diary_entries" ADD CONSTRAINT "project_diary_entries_countersigned_by_id_users_id_fk" FOREIGN KEY ("countersigned_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_diary_entries" ADD CONSTRAINT "project_diary_entries_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_diary_entries" ADD CONSTRAINT "project_diary_entries_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_instructions_company_number_idx" ON "project_instructions" USING btree ("company_id","instruction_number");--> statement-breakpoint
CREATE INDEX "project_instructions_project_idx" ON "project_instructions" USING btree ("company_id","project_id","issued_date");--> statement-breakpoint
CREATE INDEX "project_instructions_status_idx" ON "project_instructions" USING btree ("company_id","project_id","status");--> statement-breakpoint

-- One entry per day per project — the template's own rule.
CREATE UNIQUE INDEX "project_diary_entries_project_date_idx" ON "project_diary_entries" USING btree ("project_id","diary_date");--> statement-breakpoint
CREATE INDEX "project_diary_entries_company_idx" ON "project_diary_entries" USING btree ("company_id","project_id","diary_date");--> statement-breakpoint
CREATE INDEX "project_diary_entries_status_idx" ON "project_diary_entries" USING btree ("company_id","project_id","status");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security. Same tenant_isolation policy as every other
-- company-scoped table since 0001.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['project_instructions', 'project_diary_entries']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "project_instructions" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_diary_entries" TO app_user;
