-- ─────────────────────────────────────────────────────────────────────────────
-- 0079 — Technical department: Calibration (17025) & Inspection (17020).
--
-- Real tables behind what were dummy-data demo pages. Statuses are text +
-- CHECK, company-scoped, RLS'd and granted the same as every table since 0001.
-- Numbered through next_entry_number ('JOB', 'CERT', 'INS'). Touches nothing
-- outside these three new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "calibration_standards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"traceability" text DEFAULT '' NOT NULL,
	"last_calibration" date,
	"next_calibration" date,
	"uncertainty" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibration_standards_name_not_blank" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint

CREATE TABLE "calibration_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"job_number" text NOT NULL,
	"client_name" text NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"service_type" text DEFAULT '' NOT NULL,
	"scheduled_date" date,
	"technician_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"result" text DEFAULT 'pending' NOT NULL,
	"cert_number" text DEFAULT '' NOT NULL,
	"billing_status" text DEFAULT 'pending' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "calibration_jobs_client_not_blank" CHECK (length(btrim("client_name")) > 0),
	CONSTRAINT "calibration_jobs_status_valid" CHECK ("status" IN ('scheduled','in_progress','completed','cancelled')),
	CONSTRAINT "calibration_jobs_result_valid" CHECK ("result" IN ('pending','passed','failed')),
	CONSTRAINT "calibration_jobs_billing_valid" CHECK ("billing_status" IN ('pending','invoiced'))
);
--> statement-breakpoint

CREATE TABLE "inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"project_id" uuid,
	"inspection_number" text NOT NULL,
	"type" text DEFAULT '' NOT NULL,
	"equipment_serial" text DEFAULT '' NOT NULL,
	"client_name" text NOT NULL,
	"inspector_name" text DEFAULT '' NOT NULL,
	"scheduled_date" date,
	"ruling" text DEFAULT 'pending' NOT NULL,
	"appeal_status" text DEFAULT 'none' NOT NULL,
	"authority_expiry" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inspections_client_not_blank" CHECK (length(btrim("client_name")) > 0),
	CONSTRAINT "inspections_ruling_valid" CHECK ("ruling" IN ('pending','pass','fail','quarantined')),
	CONSTRAINT "inspections_appeal_valid" CHECK ("appeal_status" IN ('none','open','upheld','dismissed'))
);
--> statement-breakpoint

ALTER TABLE "calibration_standards" ADD CONSTRAINT "calibration_standards_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_standards" ADD CONSTRAINT "calibration_standards_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_standards" ADD CONSTRAINT "calibration_standards_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calibration_jobs" ADD CONSTRAINT "calibration_jobs_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "inspections" ADD CONSTRAINT "inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "calibration_standards_company_idx" ON "calibration_standards" USING btree ("company_id","next_calibration");--> statement-breakpoint
CREATE UNIQUE INDEX "calibration_jobs_company_number_idx" ON "calibration_jobs" USING btree ("company_id","job_number");--> statement-breakpoint
CREATE INDEX "calibration_jobs_company_idx" ON "calibration_jobs" USING btree ("company_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "calibration_jobs_status_idx" ON "calibration_jobs" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "inspections_company_number_idx" ON "inspections" USING btree ("company_id","inspection_number");--> statement-breakpoint
CREATE INDEX "inspections_company_idx" ON "inspections" USING btree ("company_id","scheduled_date");--> statement-breakpoint
CREATE INDEX "inspections_ruling_idx" ON "inspections" USING btree ("company_id","ruling");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['calibration_standards','calibration_jobs','inspections']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END $$;
