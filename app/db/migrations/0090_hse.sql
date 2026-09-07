-- ─────────────────────────────────────────────────────────────────────────────
-- 0090 — Health, Safety & Environment (HSE).
--
-- The HSE module's real spine, ported from the Lante ERP HSE microservice,
-- replacing the dummy-data placeholder page: sites, the incident register
-- (with NEMA/environment fields folded onto the incident), corrective actions,
-- the RAMS library, PPE issues, toolbox talks, training records and statutory
-- inspections. Company-scoped, RLS'd and granted the same as every table since
-- 0001; incident numbers come from next_entry_number('HSE'). Touches nothing
-- outside these eight new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "hse_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"project_id" uuid,
	"project_name" text DEFAULT '' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_sites_name_not_blank" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint

CREATE TABLE "hse_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"incident_number" text NOT NULL,
	"site_id" uuid,
	"site_name" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'near_miss' NOT NULL,
	"severity" text DEFAULT 'low' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reported_by_name" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"is_environmental" boolean DEFAULT false NOT NULL,
	"nema_ref" text DEFAULT '' NOT NULL,
	"nema_notification_required" boolean DEFAULT false NOT NULL,
	"nema_notified_at" timestamp with time zone,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_incidents_type_valid" CHECK ("type" IN ('near_miss','first_aid','medical_treatment','lost_time_injury','positive_observation')),
	CONSTRAINT "hse_incidents_severity_valid" CHECK ("severity" IN ('none','low','medium','high','critical')),
	CONSTRAINT "hse_incidents_status_valid" CHECK ("status" IN ('open','under_investigation','corrective_action_pending','closed'))
);
--> statement-breakpoint

CREATE TABLE "hse_corrective_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"description" text NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"due_date" date,
	"closed_at" timestamp with time zone,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_corrective_actions_desc_not_blank" CHECK (length(btrim("description")) > 0),
	CONSTRAINT "hse_corrective_actions_status_valid" CHECK ("status" IN ('open','in_progress','completed','overdue'))
);
--> statement-breakpoint

CREATE TABLE "hse_rams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"site_name" text DEFAULT '' NOT NULL,
	"subcontractor_name" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"file_url" text DEFAULT '' NOT NULL,
	"issue_notes" text DEFAULT '' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_rams_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "hse_rams_status_valid" CHECK ("status" IN ('draft','submitted','under_review','approved','rejected','expired'))
);
--> statement-breakpoint

CREATE TABLE "hse_ppe_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_name" text DEFAULT '' NOT NULL,
	"item" text NOT NULL,
	"condition" text DEFAULT 'new' NOT NULL,
	"issued_at" date,
	"returned_at" date,
	"replacement_due_at" date,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_ppe_item_not_blank" CHECK (length(btrim("item")) > 0),
	CONSTRAINT "hse_ppe_condition_valid" CHECK ("condition" IN ('new','good','worn','damaged'))
);
--> statement-breakpoint

CREATE TABLE "hse_toolbox_talks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"site_name" text DEFAULT '' NOT NULL,
	"supervisor_name" text DEFAULT '' NOT NULL,
	"topic" text NOT NULL,
	"held_on" date,
	"attendee_count" integer DEFAULT 0 NOT NULL,
	"attendees" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_toolbox_topic_not_blank" CHECK (length(btrim("topic")) > 0)
);
--> statement-breakpoint

CREATE TABLE "hse_training_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"employee_name" text DEFAULT '' NOT NULL,
	"course" text NOT NULL,
	"completed_on" date,
	"expires_on" date,
	"certificate_url" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_training_course_not_blank" CHECK (length(btrim("course")) > 0)
);
--> statement-breakpoint

CREATE TABLE "hse_statutory_inspections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"site_id" uuid,
	"site_name" text DEFAULT '' NOT NULL,
	"equipment" text NOT NULL,
	"inspector_name" text DEFAULT '' NOT NULL,
	"last_inspected_at" date,
	"due_date" date,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"certificate_url" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "hse_statutory_equipment_not_blank" CHECK (length(btrim("equipment")) > 0),
	CONSTRAINT "hse_statutory_status_valid" CHECK ("status" IN ('scheduled','passed','failed','overdue'))
);
--> statement-breakpoint

-- Foreign keys ────────────────────────────────────────────────────────────────
ALTER TABLE "hse_sites" ADD CONSTRAINT "hse_sites_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_sites" ADD CONSTRAINT "hse_sites_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_sites" ADD CONSTRAINT "hse_sites_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_sites" ADD CONSTRAINT "hse_sites_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_site_id_hse_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hse_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_incidents" ADD CONSTRAINT "hse_incidents_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_incident_id_hse_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."hse_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_corrective_actions" ADD CONSTRAINT "hse_corrective_actions_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_rams" ADD CONSTRAINT "hse_rams_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_rams" ADD CONSTRAINT "hse_rams_site_id_hse_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hse_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_rams" ADD CONSTRAINT "hse_rams_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_rams" ADD CONSTRAINT "hse_rams_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_ppe_issues" ADD CONSTRAINT "hse_ppe_issues_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_ppe_issues" ADD CONSTRAINT "hse_ppe_issues_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_ppe_issues" ADD CONSTRAINT "hse_ppe_issues_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_toolbox_talks" ADD CONSTRAINT "hse_toolbox_talks_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_toolbox_talks" ADD CONSTRAINT "hse_toolbox_talks_site_id_hse_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hse_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_toolbox_talks" ADD CONSTRAINT "hse_toolbox_talks_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_toolbox_talks" ADD CONSTRAINT "hse_toolbox_talks_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_training_records" ADD CONSTRAINT "hse_training_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_training_records" ADD CONSTRAINT "hse_training_records_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_training_records" ADD CONSTRAINT "hse_training_records_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "hse_statutory_inspections" ADD CONSTRAINT "hse_statutory_inspections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_statutory_inspections" ADD CONSTRAINT "hse_statutory_inspections_site_id_hse_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."hse_sites"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_statutory_inspections" ADD CONSTRAINT "hse_statutory_inspections_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hse_statutory_inspections" ADD CONSTRAINT "hse_statutory_inspections_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Indexes ─────────────────────────────────────────────────────────────────────
CREATE INDEX "hse_sites_company_idx" ON "hse_sites" USING btree ("company_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "hse_incidents_company_number_idx" ON "hse_incidents" USING btree ("company_id","incident_number");--> statement-breakpoint
CREATE INDEX "hse_incidents_company_idx" ON "hse_incidents" USING btree ("company_id","occurred_at");--> statement-breakpoint
CREATE INDEX "hse_incidents_status_idx" ON "hse_incidents" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "hse_corrective_actions_incident_idx" ON "hse_corrective_actions" USING btree ("incident_id");--> statement-breakpoint
CREATE INDEX "hse_corrective_actions_status_idx" ON "hse_corrective_actions" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "hse_rams_company_idx" ON "hse_rams" USING btree ("company_id","title");--> statement-breakpoint
CREATE INDEX "hse_rams_status_idx" ON "hse_rams" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "hse_ppe_company_idx" ON "hse_ppe_issues" USING btree ("company_id","issued_at");--> statement-breakpoint
CREATE INDEX "hse_toolbox_company_idx" ON "hse_toolbox_talks" USING btree ("company_id","held_on");--> statement-breakpoint
CREATE INDEX "hse_training_company_idx" ON "hse_training_records" USING btree ("company_id","expires_on");--> statement-breakpoint
CREATE INDEX "hse_statutory_company_idx" ON "hse_statutory_inspections" USING btree ("company_id","due_date");--> statement-breakpoint
CREATE INDEX "hse_statutory_status_idx" ON "hse_statutory_inspections" USING btree ("company_id","status");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'hse_sites','hse_incidents','hse_corrective_actions','hse_rams',
    'hse_ppe_issues','hse_toolbox_talks','hse_training_records','hse_statutory_inspections'
  ]
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
