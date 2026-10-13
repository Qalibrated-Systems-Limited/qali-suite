-- ─────────────────────────────────────────────────────────────────────────────
-- 0117 — Project methodology (implementation method statement).
--
-- Once a project's budget is approved, the department manager writes how the
-- works will be delivered. One method statement per project, its sections held
-- as discrete text columns. Company-scoped and RLS'd like every project table.
-- Touches only this new table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "project_methodologies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"scope" text DEFAULT '' NOT NULL,
	"approach" text DEFAULT '' NOT NULL,
	"sequence_of_works" text DEFAULT '' NOT NULL,
	"resources" text DEFAULT '' NOT NULL,
	"health_safety" text DEFAULT '' NOT NULL,
	"quality_control" text DEFAULT '' NOT NULL,
	"programme_summary" text DEFAULT '' NOT NULL,
	"risks" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "project_methodologies" ADD CONSTRAINT "project_methodologies_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_methodologies" ADD CONSTRAINT "project_methodologies_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_methodologies" ADD CONSTRAINT "project_methodologies_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_methodologies" ADD CONSTRAINT "project_methodologies_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "project_methodologies_project_uq" ON "project_methodologies" USING btree ("project_id");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
ALTER TABLE "project_methodologies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "project_methodologies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "tenant_isolation" ON "project_methodologies"
	USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
	WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "project_methodologies" TO app_user;
