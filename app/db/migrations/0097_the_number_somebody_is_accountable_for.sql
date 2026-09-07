-- ─────────────────────────────────────────────────────────────────────────────
-- 0097 — The number somebody is accountable for.
--
-- KPIs. Two Mongo models, ~1,193 lines of queries and actions, seven screens
-- and nine auto-compute formulas that read the ledger, payroll, invoices and
-- the employee register. Every one of those four stores moved to Postgres
-- long ago, so the formulas have been computing from collections nothing
-- writes any more: a KPI on `monthly_revenue` has been returning the revenue
-- of a ledger that stopped receiving entries, which is zero, and reporting it
-- as a fact with a green or red band next to it.
--
-- That is the reason this is not just a table move. `docs/CURRENT-STATE.md`
-- lists KPIs as ✅ shipped; on this branch they were shipped and wrong.
--
-- ── Decision 1 — THE OWNER IS AN EMPLOYEE AGAIN ───────────────────────────
--
-- The Mongo schema carried `owner.partyId / profileId / userId`, all
-- ObjectId. When employees moved to Postgres their ids became uuids, which do
-- not fit an ObjectId field, so `buildOwnerSubdoc` was cut back to a NAME and
-- a typed-in employee number with a comment saying that storing an id which
-- cannot resolve is worse than storing none. True — and it left a dead link:
-- rename an employee, and every KPI they own keeps the old name for ever.
--
-- `owner_employee_id` is a real foreign key now, ON DELETE SET NULL. The name
-- and number stay beside it as a snapshot, because a free-typed owner is
-- still allowed and the board should not join for a label; but where the id
-- is present it is the truth, and the read resolves through it.
--
-- ── Decision 2 — THE PERIOD SHAPE IS A CONSTRAINT, NOT A CONVENTION ───────
--
-- Mongo's rule — a quarterly snapshot sits on the end-of-quarter month, a
-- yearly one on December — lived in `normalisePeriod()` in the action layer
-- and nowhere else. Any writer that skipped it could store a quarterly
-- snapshot on month 5 carrying quarter 4, and the unique index would then
-- accept a SECOND row for that same quarter on month 6: two truths for one
-- period, and the chart drawing both. `kpi_snapshots_period_shape` makes the
-- convention structural, which is what the unique index was assuming all
-- along.
--
-- ── Decision 3 — THE SEEDER'S DEDUPE BECOMES AN INDEX ─────────────────────
--
-- `seedStarterKpis` read the existing names, diffed them against the template
-- list in JS, and inserted the remainder. Two people pressing "Use starter
-- templates" in the same few seconds both read an empty list and both insert.
-- The company gets two Monthly Revenues, which diverge from their first
-- snapshot onwards and are indistinguishable on the board.
--
-- `kpis_name_uq` is on lower(btrim(name)) — case and padding are not a
-- different KPI — and the seeder is ON CONFLICT DO NOTHING against it, so the
-- dedupe is decided once, by the database, at the moment of the write.
--
-- ── Decision 4 — THRESHOLDS MUST AGREE WITH THE DIRECTION ─────────────────
--
-- `parseKpiFormData` checked that the on-target band was stricter than the
-- near-target band, with the sense flipped for lower-is-better. It was the
-- only thing that checked: the seeder, `updateKpiTarget` and any later writer
-- could produce a KPI whose "at risk" band was harder to reach than its "on
-- track" one, which paints a number red for beating its own amber threshold.
-- Either band may still be null on its own — one overridden and one left at
-- the default is coherent — but when both are set they have to agree.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "kpi_category" AS ENUM ('financial', 'operational', 'hr', 'customer', 'compliance');--> statement-breakpoint
CREATE TYPE "kpi_source" AS ENUM ('manual', 'monthly_revenue', 'monthly_payroll_cost', 'ar_days_outstanding', 'cash_position', 'active_headcount', 'gross_margin_percent', 'opex_ratio', 'payroll_to_revenue_ratio', 'avg_order_value');--> statement-breakpoint
CREATE TYPE "kpi_unit" AS ENUM ('currency', 'percentage', 'days', 'count', 'ratio');--> statement-breakpoint
CREATE TYPE "kpi_periodicity" AS ENUM ('monthly', 'quarterly', 'yearly');--> statement-breakpoint
CREATE TYPE "kpi_target_direction" AS ENUM ('higher_is_better', 'lower_is_better');--> statement-breakpoint
CREATE TYPE "kpi_snapshot_source" AS ENUM ('manual', 'auto');--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- KPIS — the definition: a metric, a target, an owner and a period.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "kpis" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,

  "name" text NOT NULL,
  "description" text DEFAULT '' NOT NULL,

  "category" "kpi_category" NOT NULL,
  "source" "kpi_source" DEFAULT 'manual' NOT NULL,
  "unit" "kpi_unit" DEFAULT 'currency' NOT NULL,
  "periodicity" "kpi_periodicity" DEFAULT 'monthly' NOT NULL,

  "target" numeric(19, 4) NOT NULL,
  "target_direction" "kpi_target_direction" DEFAULT 'higher_is_better' NOT NULL,

  /* Ratios, not percentages: 0.95 means 95% of target. NULL = the default
     95 / 80 bands, which is what a null customThreshold meant in Mongo. */
  "on_target_threshold" numeric(9, 4),
  "near_target_threshold" numeric(9, 4),

  "status_label_on_target" text,
  "status_label_near_target" text,
  "status_label_off_target" text,

  /* Decision 1. */
  "owner_employee_id" uuid,
  "owner_name" text,
  "owner_employee_number" text,

  "is_active" boolean DEFAULT true NOT NULL,

  "created_by_id" text,
  "created_by_name" text DEFAULT 'System' NOT NULL,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "kpis_name_not_blank" CHECK (length(btrim("name")) > 0),

  /* Decision 4 — the bands have to agree, and which way round depends on the
     direction. Either may be null alone; both set means both sensible. */
  CONSTRAINT "kpis_thresholds_agree_with_direction" CHECK (
    "on_target_threshold" IS NULL OR "near_target_threshold" IS NULL OR (
      CASE WHEN "target_direction" = 'lower_is_better'
           THEN "on_target_threshold" <= "near_target_threshold"
           ELSE "on_target_threshold" >= "near_target_threshold"
      END)
  ),
  CONSTRAINT "kpis_thresholds_positive" CHECK (
    ("on_target_threshold" IS NULL OR "on_target_threshold" > 0)
    AND ("near_target_threshold" IS NULL OR "near_target_threshold" > 0)
  )
);--> statement-breakpoint

ALTER TABLE "kpis" ADD CONSTRAINT "kpis_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

/* Losing the employee record must not lose the KPI — the metric outlives
   whoever was carrying it. It falls back to the snapshot name. */
ALTER TABLE "kpis" ADD CONSTRAINT "kpis_owner_employee_id_employees_id_fk" FOREIGN KEY ("owner_employee_id") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

/* Decision 3 — the seeder's dedupe, decided by the database. Case and
   padding are not a different KPI. */
CREATE UNIQUE INDEX "kpis_name_uq" ON "kpis" USING btree ("company_id", lower(btrim("name")));--> statement-breakpoint

/* The board: active KPIs for this company, grouped by category, by name. */
CREATE INDEX "kpis_board_idx" ON "kpis" USING btree ("company_id","is_active","category","name");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- KPI SNAPSHOTS — one actual, for one KPI, for one period.
--
-- `target_at_time` is the target that was in force when the row was written.
-- It is not a convenience copy: it is the reason a snapshot still means
-- something after somebody moves the target.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE "kpi_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "kpi_id" uuid NOT NULL,

  "periodicity" "kpi_periodicity" DEFAULT 'monthly' NOT NULL,
  "period_year" integer NOT NULL,
  "period_month" integer NOT NULL,
  "period_quarter" integer,

  "actual_value" numeric(19, 4) NOT NULL,
  "target_at_time" numeric(19, 4) NOT NULL,

  "source" "kpi_snapshot_source" NOT NULL,
  "notes" text DEFAULT '' NOT NULL,

  "recorded_by_id" text,
  "recorded_by_name" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,

  CONSTRAINT "kpi_snapshots_month_in_range" CHECK ("period_month" BETWEEN 1 AND 12),
  CONSTRAINT "kpi_snapshots_year_in_range" CHECK ("period_year" BETWEEN 2000 AND 2100),

  /* Decision 2 — the shape normalisePeriod() was the only thing enforcing.
     Written as a CASE over the periodicity so the rule is stated once per
     kind rather than as three overlapping implications. */
  CONSTRAINT "kpi_snapshots_period_shape" CHECK (
    CASE "periodicity"
      WHEN 'monthly'   THEN "period_quarter" IS NULL
      WHEN 'quarterly' THEN "period_month" IN (3, 6, 9, 12)
                        AND "period_quarter" = "period_month" / 3
      WHEN 'yearly'    THEN "period_month" = 12 AND "period_quarter" = 4
    END
  )
);--> statement-breakpoint

ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

/* Deleting the definition takes its actuals with it. A snapshot with no KPI
   is not a historical record, it is an orphan number. */
ALTER TABLE "kpi_snapshots" ADD CONSTRAINT "kpi_snapshots_kpi_id_kpis_id_fk" FOREIGN KEY ("kpi_id") REFERENCES "public"."kpis"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

/* One snapshot per KPI per period — and the target of every upsert. */
CREATE UNIQUE INDEX "kpi_snapshots_period_uq" ON "kpi_snapshots" USING btree ("company_id","kpi_id","period_year","period_month");--> statement-breakpoint

/* The series read: this KPI, newest period first. */
CREATE INDEX "kpi_snapshots_series_idx" ON "kpi_snapshots" USING btree ("company_id","kpi_id","period_year" DESC,"period_month" DESC);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security, same shape as every other tenant-scoped table.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['kpis', 'kpi_snapshots'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "kpis" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "kpi_snapshots" TO app_user;
