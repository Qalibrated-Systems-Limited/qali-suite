-- ─────────────────────────────────────────────────────────────────────────────
-- 0111 — Bids & Pre-Sales.
--
-- Tenders, their compliance state and pipeline position — one real,
-- company-scoped, RLS'd table replacing the dummy Bids page. The "Pipeline" tab
-- is the open subset with a win probability. bid_number from
-- next_entry_number('BID'); owner_user_id → users; opportunity_id is a soft link
-- into CRM (no FK). Touches only this new table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "bids" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"bid_number" text NOT NULL,
	"bid_name" text NOT NULL,
	"procuring_entity" text DEFAULT '' NOT NULL,
	"value" double precision DEFAULT 0 NOT NULL,
	"win_probability" integer DEFAULT 0 NOT NULL,
	"stage" text DEFAULT 'draft' NOT NULL,
	"compliance" text DEFAULT 'pending' NOT NULL,
	"submission_deadline" date,
	"owner_user_id" text,
	"owner_name" text DEFAULT '' NOT NULL,
	"opportunity_id" text,
	"outcome_note" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bids_name_not_blank" CHECK (length(btrim("bid_name")) > 0),
	CONSTRAINT "bids_probability_range" CHECK ("win_probability" >= 0 AND "win_probability" <= 100),
	CONSTRAINT "bids_stage_valid" CHECK ("stage" IN ('draft','preparing','submitted','stage_2b','evaluation','awarded','lost','stopped')),
	CONSTRAINT "bids_compliance_valid" CHECK ("compliance" IN ('pending','compliant','non_compliant'))
);
--> statement-breakpoint

ALTER TABLE "bids" ADD CONSTRAINT "bids_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bids" ADD CONSTRAINT "bids_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "bids_company_number_idx" ON "bids" USING btree ("company_id","bid_number");--> statement-breakpoint
CREATE INDEX "bids_stage_idx" ON "bids" USING btree ("company_id","stage");--> statement-breakpoint
CREATE INDEX "bids_compliance_idx" ON "bids" USING btree ("company_id","compliance");--> statement-breakpoint
CREATE INDEX "bids_deadline_idx" ON "bids" USING btree ("company_id","submission_deadline");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bids']
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
