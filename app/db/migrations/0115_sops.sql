-- ─────────────────────────────────────────────────────────────────────────────
-- 0115 — SOP Library.
--
-- Controlled documents and their review schedule, replacing the dummy SOP page.
-- One company-scoped, RLS'd table. Codes from next_entry_number('SOP');
-- "review due" is derived from status + next_review at read time. Touches only
-- this new table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "sops" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"code" text NOT NULL,
	"title" text NOT NULL,
	"department" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"version" text DEFAULT 'v1' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"owner_user_id" text,
	"owner_name" text DEFAULT '' NOT NULL,
	"last_reviewed" date,
	"next_review" date,
	"review_note" text DEFAULT '' NOT NULL,
	"file_url" text,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sops_title_not_blank" CHECK (length(btrim("title")) > 0),
	CONSTRAINT "sops_status_valid" CHECK ("status" IN ('draft','in_review','approved','retired'))
);
--> statement-breakpoint

ALTER TABLE "sops" ADD CONSTRAINT "sops_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sops" ADD CONSTRAINT "sops_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "sops_company_code_idx" ON "sops" USING btree ("company_id","code");--> statement-breakpoint
CREATE INDEX "sops_status_idx" ON "sops" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "sops_next_review_idx" ON "sops" USING btree ("company_id","next_review");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sops']
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
