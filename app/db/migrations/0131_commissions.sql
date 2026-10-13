-- 0125 — sales commission (tiered, manual) and the earners leaderboard.
--
-- Adapted from the QSL ERP3 prototype's commission idea into a real
-- tenant-scoped module. commission_tiers holds the multipliers (T1 1.0× …
-- T4 2.0×, seeded lazily per company by the app). staff_commissions records,
-- per employee per month, the credited revenue, the tier applied (multiplier
-- snapshotted), the resulting commission, and whether it is paid. The
-- leaderboard is an aggregate over staff_commissions; no table of its own.

CREATE TABLE "commission_tiers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "level" text NOT NULL,
  "name" text DEFAULT '' NOT NULL,
  "multiplier" numeric(5, 2) DEFAULT '1' NOT NULL,
  "min_revenue" numeric(19, 4),
  "description" text DEFAULT '' NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "commission_tiers_level_not_blank" CHECK (length(btrim("level")) > 0),
  CONSTRAINT "commission_tiers_multiplier_nonneg" CHECK ("multiplier" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_commissions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "employee_id" uuid NOT NULL,
  "period_month" date NOT NULL,
  "revenue_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "tier_level" text DEFAULT '' NOT NULL,
  "tier_multiplier" numeric(5, 2) DEFAULT '1' NOT NULL,
  "commission_amount" numeric(19, 4) DEFAULT '0' NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "paid_on" date,
  "note" text DEFAULT '' NOT NULL,
  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "staff_commissions_status_valid" CHECK ("status" IN ('pending', 'paid')),
  CONSTRAINT "staff_commissions_amounts_nonneg" CHECK ("revenue_amount" >= 0 AND "commission_amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "commission_tiers"
  ADD CONSTRAINT "commission_tiers_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_commissions"
  ADD CONSTRAINT "staff_commissions_company_id_companies_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "staff_commissions"
  ADD CONSTRAINT "staff_commissions_employee_id_employees_id_fk"
  FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "commission_tiers_company_level_uq"
  ON "commission_tiers" USING btree ("company_id", lower("level"));
--> statement-breakpoint
CREATE INDEX "commission_tiers_company_sort_idx"
  ON "commission_tiers" USING btree ("company_id", "sort_order");
--> statement-breakpoint
CREATE INDEX "staff_commissions_company_month_idx"
  ON "staff_commissions" USING btree ("company_id", "period_month");
--> statement-breakpoint
CREATE INDEX "staff_commissions_company_employee_idx"
  ON "staff_commissions" USING btree ("company_id", "employee_id");
--> statement-breakpoint
CREATE INDEX "staff_commissions_company_status_idx"
  ON "staff_commissions" USING btree ("company_id", "status");
--> statement-breakpoint

-- Row-level security — the same tenant_isolation policy every company table uses.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['commission_tiers', 'staff_commissions']
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
