-- ─────────────────────────────────────────────────────────────────────────────
-- 0116 — Compliance.
--
-- Certificates, statutory obligations and renewal tasks — three company-scoped,
-- RLS'd tables replacing the dummy Compliance page. A certificate's
-- current/expiring/expired state is derived from its expiry at read time; a task
-- optionally links to the certificate it renews and cascades on cert delete.
-- Touches only these three new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "compliance_certificates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"responsible_user_id" text,
	"responsible_name" text DEFAULT '' NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"issue_date" date,
	"expiry_date" date,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_cert_name_not_blank" CHECK (length(btrim("name")) > 0)
);
--> statement-breakpoint

CREATE TABLE "compliance_obligations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"agency" text DEFAULT '' NOT NULL,
	"next_due" date,
	"frequency" text DEFAULT 'monthly' NOT NULL,
	"penalty" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_oblig_name_not_blank" CHECK (length(btrim("name")) > 0),
	CONSTRAINT "compliance_oblig_frequency_valid" CHECK ("frequency" IN ('monthly','quarterly','annual','one_off'))
);
--> statement-breakpoint

CREATE TABLE "compliance_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text NOT NULL,
	"assigned_user_id" text,
	"assigned_name" text DEFAULT '' NOT NULL,
	"due_date" date,
	"status" text DEFAULT 'open' NOT NULL,
	"certificate_id" uuid,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_task_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "compliance_task_status_valid" CHECK ("status" IN ('open','in_progress','done'))
);
--> statement-breakpoint

ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_cert_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_cert_responsible_user_id_users_id_fk" FOREIGN KEY ("responsible_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_cert_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_certificates" ADD CONSTRAINT "compliance_cert_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_oblig_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_oblig_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_obligations" ADD CONSTRAINT "compliance_oblig_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_task_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_task_certificate_id_fk" FOREIGN KEY ("certificate_id") REFERENCES "public"."compliance_certificates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_task_assigned_user_id_users_id_fk" FOREIGN KEY ("assigned_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_task_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_tasks" ADD CONSTRAINT "compliance_task_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "compliance_cert_company_idx" ON "compliance_certificates" USING btree ("company_id","expiry_date");--> statement-breakpoint
CREATE INDEX "compliance_oblig_company_idx" ON "compliance_obligations" USING btree ("company_id","next_due");--> statement-breakpoint
CREATE INDEX "compliance_task_company_idx" ON "compliance_tasks" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "compliance_task_due_idx" ON "compliance_tasks" USING btree ("company_id","due_date");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['compliance_certificates','compliance_obligations','compliance_tasks']
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
