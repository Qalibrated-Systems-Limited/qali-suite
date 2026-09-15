-- ─────────────────────────────────────────────────────────────────────────────
-- 0114 — Quality Management System (QMS).
--
-- The ISO 9001 / 17025 quality spine replacing the dummy QMS page — distinct
-- from the materials `nonconformances` table. Four company-scoped, RLS'd tables:
-- quality non-conformances (NC-####) → CAPAs (CAPA-####, cascading), the
-- internal-audit programme (AUD-####) and the management-review record
-- (MR-####). Numbers from next_entry_number. Touches only these four new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "qms_nonconformances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"nc_number" text NOT NULL,
	"source" text DEFAULT 'internal_audit' NOT NULL,
	"category" text DEFAULT 'process' NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"iso_clause" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'minor' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"root_cause" text DEFAULT '' NOT NULL,
	"owner_user_id" text,
	"owner_name" text DEFAULT '' NOT NULL,
	"due_date" date,
	"closed_at" timestamp with time zone,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qms_nc_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "qms_nc_source_valid" CHECK ("source" IN ('internal_audit','external_audit','customer_complaint','supplier','process','product','other')),
	CONSTRAINT "qms_nc_category_valid" CHECK ("category" IN ('process','product','system','external','other')),
	CONSTRAINT "qms_nc_severity_valid" CHECK ("severity" IN ('minor','major','critical')),
	CONSTRAINT "qms_nc_status_valid" CHECK ("status" IN ('open','capa_in_progress','effectiveness_check','closed','cancelled'))
);
--> statement-breakpoint

CREATE TABLE "qms_capas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"capa_number" text NOT NULL,
	"nonconformance_id" uuid NOT NULL,
	"type" text DEFAULT 'corrective' NOT NULL,
	"action" text DEFAULT '' NOT NULL,
	"owner_user_id" text,
	"owner_name" text DEFAULT '' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"effectiveness_due" date,
	"effectiveness_result" text DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_name" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qms_capa_type_valid" CHECK ("type" IN ('corrective','preventive')),
	CONSTRAINT "qms_capa_status_valid" CHECK ("status" IN ('open','in_progress','completed','verified','cancelled')),
	CONSTRAINT "qms_capa_effectiveness_valid" CHECK ("effectiveness_result" IN ('pending','effective','not_effective'))
);
--> statement-breakpoint

CREATE TABLE "qms_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"audit_number" text NOT NULL,
	"title" text NOT NULL,
	"standard" text DEFAULT '' NOT NULL,
	"auditor_user_id" text,
	"auditor_name" text DEFAULT '' NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"planned_date" date,
	"completed_date" date,
	"findings" text DEFAULT '' NOT NULL,
	"findings_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qms_audit_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "qms_audit_status_valid" CHECK ("status" IN ('planned','in_progress','closed','cancelled'))
);
--> statement-breakpoint

CREATE TABLE "qms_management_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"review_number" text NOT NULL,
	"review_date" date,
	"chaired_by" text DEFAULT '' NOT NULL,
	"attendees" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"decisions" text DEFAULT '' NOT NULL,
	"actions_count" integer DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "qms_mr_status_valid" CHECK ("status" IN ('scheduled','held','cancelled'))
);
--> statement-breakpoint

ALTER TABLE "qms_nonconformances" ADD CONSTRAINT "qms_nc_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_nonconformances" ADD CONSTRAINT "qms_nc_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_nonconformances" ADD CONSTRAINT "qms_nc_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_nonconformances" ADD CONSTRAINT "qms_nc_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "qms_capas" ADD CONSTRAINT "qms_capa_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_capas" ADD CONSTRAINT "qms_capa_nc_id_fk" FOREIGN KEY ("nonconformance_id") REFERENCES "public"."qms_nonconformances"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_capas" ADD CONSTRAINT "qms_capa_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_capas" ADD CONSTRAINT "qms_capa_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_capas" ADD CONSTRAINT "qms_capa_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audit_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audit_auditor_user_id_users_id_fk" FOREIGN KEY ("auditor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audit_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_audits" ADD CONSTRAINT "qms_audit_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "qms_management_reviews" ADD CONSTRAINT "qms_mr_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_management_reviews" ADD CONSTRAINT "qms_mr_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qms_management_reviews" ADD CONSTRAINT "qms_mr_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "qms_nc_company_number_idx" ON "qms_nonconformances" USING btree ("company_id","nc_number");--> statement-breakpoint
CREATE INDEX "qms_nc_status_idx" ON "qms_nonconformances" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qms_capa_company_number_idx" ON "qms_capas" USING btree ("company_id","capa_number");--> statement-breakpoint
CREATE INDEX "qms_capa_nc_idx" ON "qms_capas" USING btree ("nonconformance_id");--> statement-breakpoint
CREATE INDEX "qms_capa_status_idx" ON "qms_capas" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qms_audit_company_number_idx" ON "qms_audits" USING btree ("company_id","audit_number");--> statement-breakpoint
CREATE INDEX "qms_audit_status_idx" ON "qms_audits" USING btree ("company_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "qms_mr_company_number_idx" ON "qms_management_reviews" USING btree ("company_id","review_number");--> statement-breakpoint
CREATE INDEX "qms_mr_status_idx" ON "qms_management_reviews" USING btree ("company_id","status");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['qms_nonconformances','qms_capas','qms_audits','qms_management_reviews']
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
