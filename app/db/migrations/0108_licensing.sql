-- ─────────────────────────────────────────────────────────────────────────────
-- 0108 — Licensing.
--
-- The license spine ported from the Lante ERP License microservice
-- (packages/microservices/licensing) — the same kind of port as Help Desk
-- (0104, from Ticketing) and HSE (0105). It issues, validates, revokes and
-- renews ES256-signed JWT license keys for the QaliTrack product line.
--
--   licenses           — the issued keys. `token` holds the signed JWT that IS
--                        the customer's key; the row is the server record used
--                        to validate / revoke / renew / audit it.
--   license_audit_logs — append-only lifecycle trail (issued, validated,
--                        revoked, renewed), same idea as the .NET
--                        LicenseAuditLog interceptor.
--
-- Company-scoped, RLS'd and granted the same as every table since 0001 — the
-- ISSUING tenant owns the records; customer_id/customer_name name the external
-- holder, who is not a tenant here. License numbers come from
-- next_entry_number('LIC'). Touches nothing outside these two new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"license_number" text NOT NULL,
	"token" text NOT NULL,
	"customer_id" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"app_id" text NOT NULL,
	"features" text DEFAULT '' NOT NULL,
	"machine_id" text,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked" boolean DEFAULT false NOT NULL,
	"revoke_reason" text,
	"last_seen" timestamp with time zone,
	"last_machine_id" text,
	"notes" text,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "licenses_customer_not_blank" CHECK (length(btrim("customer_id")) > 0),
	CONSTRAINT "licenses_app_not_blank" CHECK (length(btrim("app_id")) > 0)
);
--> statement-breakpoint

CREATE TABLE "license_audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"license_id" uuid,
	"entity" text DEFAULT 'License' NOT NULL,
	"entity_id" text DEFAULT '' NOT NULL,
	"action" text NOT NULL,
	"actor_id" text,
	"actor_name" text DEFAULT 'System' NOT NULL,
	"details" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "licenses" ADD CONSTRAINT "licenses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "licenses" ADD CONSTRAINT "licenses_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "license_audit_logs" ADD CONSTRAINT "license_audit_logs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_audit_logs" ADD CONSTRAINT "license_audit_logs_license_id_licenses_id_fk" FOREIGN KEY ("license_id") REFERENCES "public"."licenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "license_audit_logs" ADD CONSTRAINT "license_audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "licenses_token_idx" ON "licenses" USING btree ("token");--> statement-breakpoint
CREATE UNIQUE INDEX "licenses_company_number_idx" ON "licenses" USING btree ("company_id","license_number");--> statement-breakpoint
CREATE INDEX "licenses_customer_idx" ON "licenses" USING btree ("company_id","customer_id");--> statement-breakpoint
CREATE INDEX "licenses_app_idx" ON "licenses" USING btree ("company_id","app_id");--> statement-breakpoint
CREATE INDEX "licenses_expiry_idx" ON "licenses" USING btree ("company_id","expires_at");--> statement-breakpoint
CREATE INDEX "license_audit_license_idx" ON "license_audit_logs" USING btree ("license_id","at");--> statement-breakpoint
CREATE INDEX "license_audit_company_idx" ON "license_audit_logs" USING btree ("company_id","at");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['licenses','license_audit_logs']
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
