-- ============================================================================
-- 0056 — Fixed assets: the register, and the three entries it raises.
--
-- The last of §9G's modules with screens. `asset-actions.js` posts through the
-- Mongo JournalEntry model while every ledger screen reads Postgres, so
-- depreciation, impairment and disposal all landed in a ledger nothing reads.
--
--   postDepreciation   DR Depreciation Expense       CR Accumulated Depreciation
--   impairAsset        DR Impairment Loss            CR Accumulated Depreciation
--   disposeAsset       DR Bank (proceeds)            CR Fixed Asset (cost)
--                      DR Accumulated Depreciation   CR Gain on disposal
--                      DR Loss on disposal
--
-- ACQUISITION IS NOT ONE OF THEM. The plan's table and BUILDING-ON-POSTGRES
-- both say "acquisition, depreciation, disposal"; `createAsset` posts nothing.
-- It tags the bill line with `capitalizedAssetId` and stops, because the BILL
-- already posted DR Fixed Asset / CR Accounts Payable when it was approved.
-- There is nothing left to raise, and raising something would double the
-- asset. The third entry is impairment. Both documents are corrected.
--
-- ── Five decisions ──────────────────────────────────────────────────────────
--
-- 1. ACCUMULATED DEPRECIATION IS DERIVED FROM WHAT WAS POSTED.
--    This is the important one. `recordDepreciation` sets
--
--        this.accumulatedDepreciation = entry.accumulatedDepreciation;
--
--    — it takes the running total from the SCHEDULE ROW, which is a
--    projection of every month up to that point, rather than from what has
--    actually reached the ledger. And `postDepreciation` accepts whatever
--    period the form sends and looks only for a pending row in THAT month:
--
--        depreciationSchedule: { $elemMatch: { period, status: "pending" } }
--
--    There is no check that earlier periods were posted first. So run
--    month-end for March having missed January and February, and the ledger
--    receives one month of depreciation while the asset register claims
--    three. The balance sheet's Accumulated Depreciation and the asset
--    register then disagree, permanently, and nothing reconciles them.
--
--    `asset_state` sums the rows that are actually POSTED, plus impairments.
--    The register cannot claim depreciation the ledger has not seen, because
--    there is no longer a second place for the figure to live. §4.4.
--
-- 2. ONE POSTING PER ASSET PER PERIOD.
--    The Mongo guard is a find-then-write with no lock, which two concurrent
--    runs of a month-end job both pass. `asset_depreciation_period_unique` is
--    a unique index on (asset_id, period), so the second one cannot be
--    written at all.
--
-- 3. A POSTED PERIOD IS IMMUTABLE.
--    An impairment REWRITES the remaining schedule (`applyImpairment`, IFRS
--    revised carrying amount), and it filters on `status === "pending"` to
--    avoid touching history. That is a filter in application code over an
--    array; here it is a trigger, so nothing can rewrite a month whose entry
--    is already in the ledger.
--
-- 4. AN ASSET IS DISPOSED OF ONCE.
--    `journalEntryIds` was an unconstrained array. A second disposal would
--    credit the asset cost a second time and take the register negative.
--    `asset_journal_entries_disposal_once` makes it impossible.
--
-- 5. REDUCING BALANCE ACTUALLY USES THE RATE IT STATES.
--    `asset.js` computes the monthly rate as `depreciationRate / 12`, which
--    compounds to LESS than the annual rate it claims:
--
--        stated 25.0%  ->  22.33% charged in year one
--        stated 37.5%  ->  31.68%
--        stated 30.0%  ->  26.20%
--        stated 12.5%  ->  11.81%
--
--    Those rates are the KRA wear-and-tear classes, and KRA computes
--    wear-and-tear ANNUALLY on the reducing balance — so book depreciation was
--    running about 11% under the tax computation it is named after, for every
--    reducing-balance asset. The monthly rate that compounds to `r` over
--    twelve months is 1 - (1 - r)^(1/12), and that is what the port uses.
--
--    This is a DELIBERATE DIVERGENCE from Mongo. Straight line is untouched
--    and reconciles exactly; the reducing-balance tests assert the corrected
--    figures and say so.
--
--    The other half of the same method is left alone but made visible.
--    Reducing balance approaches salvage asymptotically and the schedule
--    simply stops at the useful life — after 60 months at 25%, 282,745 of a
--    1,000,000 asset is still on the books against a zero salvage value, and
--    nothing writes it off. `asset_state.unwritten_residue` reports it, so a
--    register can show what will never be charged instead of carrying it in
--    silence.
--
-- 6. THE SCHEDULE STILL ROUNDS TO WHOLE SHILLINGS.
--    `generateSchedule` uses `Math.round(depreciableAmount / usefulLifeMonths)`
--    — whole units, not cents — and trues the final month up to the exact
--    remainder so the schedule sums to the depreciable amount regardless.
--    That is a deliberate KES convention and it is ported unchanged. The
--    columns are NUMERIC(19,4) like every other money column, so the rounding
--    is a domain choice rather than a limit of the type.
-- ============================================================================

CREATE TYPE "public"."asset_category" AS ENUM (
  'land', 'building', 'leasehold_improvement', 'vehicle', 'machinery',
  'office_equipment', 'computer', 'furniture', 'equipment', 'other'
);--> statement-breakpoint

CREATE TYPE "public"."asset_status" AS ENUM (
  'active', 'idle', 'in_maintenance', 'disposed', 'written_off'
);--> statement-breakpoint

CREATE TYPE "public"."depreciation_method" AS ENUM (
  'straight_line', 'reducing_balance', 'none'
);--> statement-breakpoint

CREATE TYPE "public"."depreciation_convention" AS ENUM (
  'full_month', 'pro_rata'
);--> statement-breakpoint

CREATE TYPE "public"."depreciation_period_status" AS ENUM (
  'pending', 'posted', 'skipped'
);--> statement-breakpoint

CREATE TYPE "public"."disposal_method" AS ENUM (
  'sold', 'scrapped', 'donated', 'lost', 'stolen'
);--> statement-breakpoint

CREATE TYPE "public"."kra_class" AS ENUM (
  'class_I', 'class_II', 'class_III', 'class_IV', 'none'
);--> statement-breakpoint

CREATE TYPE "public"."usage_unit" AS ENUM ('km', 'miles', 'hours');--> statement-breakpoint

ALTER TABLE "company_settings"
  ADD COLUMN IF NOT EXISTS "asset_prefix" text NOT NULL DEFAULT 'AST';--> statement-breakpoint

CREATE OR REPLACE FUNCTION document_prefix(p_company_id uuid, p_kind text)
RETURNS text AS $$
DECLARE
  v_prefix text;
BEGIN
  SELECT CASE p_kind
           WHEN 'invoice' THEN s.invoice_prefix
           WHEN 'bill'    THEN s.bill_prefix
           WHEN 'quote'   THEN s.quote_prefix
           WHEN 'po'      THEN s.po_prefix
           WHEN 'grn'     THEN s.grn_prefix
           WHEN 'ncr'     THEN s.ncr_prefix
           WHEN 'claim'   THEN s.claim_prefix
           WHEN 'asset'   THEN s.asset_prefix
         END
    INTO v_prefix
    FROM company_settings s
   WHERE s.company_id = p_company_id;

  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := CASE p_kind
                  WHEN 'invoice' THEN 'INV'
                  WHEN 'bill'    THEN 'BILL'
                  WHEN 'quote'   THEN 'QT'
                  WHEN 'po'      THEN 'PO'
                  WHEN 'grn'     THEN 'GRN'
                  WHEN 'ncr'     THEN 'NCR'
                  WHEN 'claim'   THEN 'CLAIM'
                  WHEN 'asset'   THEN 'AST'
                  ELSE upper(p_kind)
                END;
  END IF;

  RETURN v_prefix;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Tables
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "assets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_number" text NOT NULL,

  "name" text NOT NULL,
  "description" text,
  "category" "asset_category" NOT NULL,
  "status" "asset_status" NOT NULL DEFAULT 'active',

  "serial_number" text,
  "model" text,
  "manufacturer" text,
  "registration_number" text,

  "location" text,
  "department" text,
  "assigned_to_party_id" uuid,

  "acquisition_date" date NOT NULL,
  "acquisition_cost" numeric(19,4) NOT NULL,
  "currency" text NOT NULL DEFAULT 'KES',

  "source_type" text NOT NULL DEFAULT 'manual',
  "source_id" uuid,
  "source_reference" text,

  "depreciation_method" "depreciation_method" NOT NULL DEFAULT 'straight_line',
  "useful_life_months" integer NOT NULL DEFAULT 60,
  "salvage_value" numeric(19,4) NOT NULL DEFAULT 0,
  "depreciation_rate" numeric(9,6) NOT NULL DEFAULT 0,
  "depreciation_start_date" date NOT NULL,
  "depreciation_convention" "depreciation_convention" NOT NULL DEFAULT 'full_month',

  "kra_class" "kra_class" NOT NULL DEFAULT 'none',

  "asset_account_id" uuid,
  "accumulated_depreciation_account_id" uuid,
  "depreciation_expense_account_id" uuid,

  "disposed_at" timestamp with time zone,
  "disposed_by_id" text,
  "disposed_by_name" text,
  "disposal_method" "disposal_method",
  "disposal_amount" numeric(19,4) NOT NULL DEFAULT 0,
  "disposal_notes" text,

  "usage_unit" "usage_unit" NOT NULL DEFAULT 'km',
  "photo_url" text,

  "insurance_provider" text,
  "insurance_policy_number" text,
  "insurance_expiry_date" date,
  "insurance_premium" numeric(19,4),
  "inspection_last_date" date,
  "inspection_next_due_date" date,

  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "last_modified_by_id" text,
  "last_modified_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "assets_cost_not_negative" CHECK ("acquisition_cost" >= 0),
  CONSTRAINT "assets_salvage_within_cost"
    CHECK ("salvage_value" >= 0 AND "salvage_value" <= "acquisition_cost"),
  CONSTRAINT "assets_rate_is_a_fraction"
    CHECK ("depreciation_rate" >= 0 AND "depreciation_rate" <= 1),
  CONSTRAINT "assets_useful_life_in_range"
    CHECK ("useful_life_months" >= 0 AND "useful_life_months" <= 1200),
  -- Land is what 'none' is for; everything else needs a life to spread over.
  CONSTRAINT "assets_depreciating_has_a_life"
    CHECK ("depreciation_method" = 'none' OR "useful_life_months" > 0),
  CONSTRAINT "assets_reducing_balance_has_a_rate"
    CHECK ("depreciation_method" <> 'reducing_balance' OR "depreciation_rate" > 0),
  CONSTRAINT "assets_disposal_is_complete"
    CHECK ("status" <> 'disposed'
           OR ("disposed_at" IS NOT NULL AND "disposal_method" IS NOT NULL)),
  CONSTRAINT "assets_disposal_amount_not_negative" CHECK ("disposal_amount" >= 0),
  CONSTRAINT "assets_depreciation_starts_after_acquisition"
    CHECK ("depreciation_start_date" >= "acquisition_date")
);--> statement-breakpoint

ALTER TABLE "assets" ADD CONSTRAINT "assets_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_assigned_to_party_id_fk"
  FOREIGN KEY ("assigned_to_party_id") REFERENCES "public"."parties"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_asset_account_id_fk"
  FOREIGN KEY ("asset_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_accum_dep_account_id_fk"
  FOREIGN KEY ("accumulated_depreciation_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_dep_expense_account_id_fk"
  FOREIGN KEY ("depreciation_expense_account_id") REFERENCES "public"."accounts"("id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "assets_number_unique" ON "assets" ("company_id", "asset_number");--> statement-breakpoint
CREATE INDEX "assets_list_idx" ON "assets" ("company_id", "status", "category");--> statement-breakpoint
CREATE INDEX "assets_category_idx" ON "assets" ("company_id", "category");--> statement-breakpoint
CREATE INDEX "assets_assigned_idx" ON "assets" ("company_id", "assigned_to_party_id")
  WHERE "assigned_to_party_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "assets_source_idx" ON "assets" ("company_id", "source_type", "source_id")
  WHERE "source_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "asset_depreciation_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "period" text NOT NULL,
  "year" integer NOT NULL,
  "month" integer NOT NULL,
  "depreciation_amount" numeric(19,4) NOT NULL,
  -- What the SCHEDULE PROJECTS, not what the asset is actually carrying.
  -- Decision 1 — asset_state is the position.
  "accumulated_depreciation" numeric(19,4) NOT NULL,
  "book_value" numeric(19,4) NOT NULL,
  "status" "depreciation_period_status" NOT NULL DEFAULT 'pending',
  "journal_entry_id" uuid,
  "posted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "asset_depreciation_amount_not_negative" CHECK ("depreciation_amount" >= 0),
  CONSTRAINT "asset_depreciation_month_valid" CHECK ("month" BETWEEN 1 AND 12),
  CONSTRAINT "asset_depreciation_period_matches"
    CHECK ("period" = "year"::text || '-' || lpad("month"::text, 2, '0')),
  CONSTRAINT "asset_depreciation_posted_has_an_entry"
    CHECK (("status" = 'posted') = ("journal_entry_id" IS NOT NULL)),
  CONSTRAINT "asset_depreciation_posted_has_a_time"
    CHECK (("status" = 'posted') = ("posted_at" IS NOT NULL))
);--> statement-breakpoint

ALTER TABLE "asset_depreciation_schedule" ADD CONSTRAINT "asset_depreciation_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_depreciation_schedule" ADD CONSTRAINT "asset_depreciation_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_depreciation_schedule" ADD CONSTRAINT "asset_depreciation_entry_id_fk"
  FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict;--> statement-breakpoint

-- Decision 2: one row per asset per month, so one posting per asset per month.
CREATE UNIQUE INDEX "asset_depreciation_period_unique"
  ON "asset_depreciation_schedule" ("asset_id", "period");--> statement-breakpoint
CREATE INDEX "asset_depreciation_pending_idx"
  ON "asset_depreciation_schedule" ("company_id", "period", "status")
  WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "asset_depreciation_asset_idx"
  ON "asset_depreciation_schedule" ("asset_id", "year", "month");--> statement-breakpoint
CREATE INDEX "asset_depreciation_entry_idx"
  ON "asset_depreciation_schedule" ("company_id", "journal_entry_id")
  WHERE "journal_entry_id" IS NOT NULL;--> statement-breakpoint

CREATE TABLE "asset_transfers" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "transferred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "from_location" text, "to_location" text,
  "from_department" text, "to_department" text,
  "from_assigned_to_name" text, "to_assigned_to_name" text,
  "reason" text,
  "transferred_by_id" text,
  "transferred_by_name" text
);--> statement-breakpoint

ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_transfers" ADD CONSTRAINT "asset_transfers_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "asset_transfers_asset_idx" ON "asset_transfers" ("asset_id", "transferred_at");--> statement-breakpoint
CREATE INDEX "asset_transfers_company_idx" ON "asset_transfers" ("company_id", "transferred_at");--> statement-breakpoint

CREATE TABLE "asset_impairments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "impaired_at" timestamp with time zone NOT NULL DEFAULT now(),
  "amount" numeric(19,4) NOT NULL,
  "reason" text NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "impaired_by_id" text,
  "impaired_by_name" text,
  CONSTRAINT "asset_impairments_amount_positive" CHECK ("amount" > 0)
);--> statement-breakpoint

ALTER TABLE "asset_impairments" ADD CONSTRAINT "asset_impairments_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_impairments" ADD CONSTRAINT "asset_impairments_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_impairments" ADD CONSTRAINT "asset_impairments_entry_id_fk"
  FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict;--> statement-breakpoint
CREATE INDEX "asset_impairments_asset_idx" ON "asset_impairments" ("asset_id", "impaired_at");--> statement-breakpoint
CREATE UNIQUE INDEX "asset_impairments_entry_unique" ON "asset_impairments" ("journal_entry_id");--> statement-breakpoint

CREATE TABLE "asset_usage_readings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  "reading" numeric(19,4) NOT NULL,
  "unit" "usage_unit" NOT NULL DEFAULT 'km',
  "source" text NOT NULL DEFAULT 'manual',
  "source_kind" text,
  "source_ref_id" text,
  "notes" text,
  "recorded_by_id" text,
  "recorded_by_name" text,
  CONSTRAINT "asset_usage_reading_not_negative" CHECK ("reading" >= 0)
);--> statement-breakpoint

ALTER TABLE "asset_usage_readings" ADD CONSTRAINT "asset_usage_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_usage_readings" ADD CONSTRAINT "asset_usage_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "asset_usage_asset_idx" ON "asset_usage_readings" ("asset_id", "recorded_at");--> statement-breakpoint

CREATE TABLE "asset_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "name" text NOT NULL,
  "url" text NOT NULL,
  "uploaded_at" timestamp with time zone NOT NULL DEFAULT now()
);--> statement-breakpoint

ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_documents" ADD CONSTRAINT "asset_documents_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
CREATE INDEX "asset_documents_asset_idx" ON "asset_documents" ("company_id", "asset_id");--> statement-breakpoint

CREATE TABLE "asset_journal_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "asset_id" uuid NOT NULL,
  "journal_entry_id" uuid NOT NULL,
  "purpose" text NOT NULL,
  "period" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "asset_journal_entries_purpose_valid"
    CHECK ("purpose" IN ('depreciation', 'impairment', 'disposal'))
);--> statement-breakpoint

ALTER TABLE "asset_journal_entries" ADD CONSTRAINT "asset_journal_entries_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_journal_entries" ADD CONSTRAINT "asset_journal_entries_asset_id_fk"
  FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "asset_journal_entries" ADD CONSTRAINT "asset_journal_entries_entry_id_fk"
  FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "asset_journal_entries_unique"
  ON "asset_journal_entries" ("asset_id", "journal_entry_id");--> statement-breakpoint

-- Decision 4: an asset is disposed of once.
CREATE UNIQUE INDEX "asset_journal_entries_disposal_once"
  ON "asset_journal_entries" ("asset_id") WHERE "purpose" = 'disposal';--> statement-breakpoint

CREATE INDEX "asset_journal_entries_entry_idx"
  ON "asset_journal_entries" ("company_id", "journal_entry_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Decision 3: a posted period is immutable.
--
-- `applyImpairment` rewrites the remaining schedule over the same horizon —
-- the IFRS revised carrying amount — and avoids history by filtering
-- `status === "pending"` in JavaScript, over an array, in one function. Any
-- other writer rewrites whatever it likes.
--
-- Once a month's entry is in the ledger, its row is a record of what was
-- posted. The only transition allowed out of `posted` is none.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION asset_depreciation_row_immutable() RETURNS trigger AS $$
BEGIN
  -- COALESCE, not NEW. In a BEFORE DELETE trigger NEW is NULL, and returning
  -- NULL cancels the row silently — which made every schedule rebuild a no-op
  -- and then collided on the unique index. The tests caught it.
  IF OLD.status <> 'posted' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Depreciation for % has been posted to the ledger and cannot be deleted.',
      OLD.period
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.depreciation_amount IS DISTINCT FROM OLD.depreciation_amount
     OR NEW.accumulated_depreciation IS DISTINCT FROM OLD.accumulated_depreciation
     OR NEW.book_value IS DISTINCT FROM OLD.book_value
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.journal_entry_id IS DISTINCT FROM OLD.journal_entry_id
     OR NEW.period IS DISTINCT FROM OLD.period
  THEN
    RAISE EXCEPTION
      'Depreciation for % has been posted to the ledger and can no longer be changed.',
      OLD.period
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "asset_depreciation_row_immutable"
BEFORE UPDATE OR DELETE ON "asset_depreciation_schedule"
FOR EACH ROW EXECUTE FUNCTION asset_depreciation_row_immutable();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- A disposed asset is finished with.
--
-- `disposeAsset` sets status and stops; nothing prevents a later depreciation
-- run, impairment or transfer from picking the asset up again — the month-end
-- job filters on `status: "active"`, so it would not, but the three actions
-- that write directly never check.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION asset_is_not_disposed() RETURNS trigger AS $$
DECLARE
  a record;
BEGIN
  SELECT asset_number, status INTO a FROM assets WHERE id = NEW.asset_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  IF a.status IN ('disposed', 'written_off') THEN
    RAISE EXCEPTION 'Asset % is %, so nothing further can be recorded against it.',
      a.asset_number, a.status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "asset_impairment_not_after_disposal"
BEFORE INSERT ON "asset_impairments"
FOR EACH ROW EXECUTE FUNCTION asset_is_not_disposed();--> statement-breakpoint

CREATE TRIGGER "asset_transfer_not_after_disposal"
BEFORE INSERT ON "asset_transfers"
FOR EACH ROW EXECUTE FUNCTION asset_is_not_disposed();--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Depreciation cannot take an asset below its salvage value.
--
-- `generateSchedule` clamps for this while building the schedule, and
-- `applyImpairment` clamps again while revising it. Both are application-side.
-- This is the floor under both: whatever writes the row, the total posted plus
-- impairments cannot exceed what there is to depreciate.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION asset_depreciation_within_cost() RETURNS trigger AS $$
DECLARE
  a          record;
  posted     numeric(19,4);
  impaired   numeric(19,4);
BEGIN
  IF NEW.status <> 'posted' THEN
    RETURN NEW;
  END IF;

  SELECT asset_number, acquisition_cost, salvage_value INTO a
    FROM assets WHERE id = NEW.asset_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(depreciation_amount), 0) INTO posted
    FROM asset_depreciation_schedule
   WHERE asset_id = NEW.asset_id AND status = 'posted' AND id <> NEW.id;

  SELECT COALESCE(SUM(amount), 0) INTO impaired
    FROM asset_impairments WHERE asset_id = NEW.asset_id;

  IF posted + impaired + NEW.depreciation_amount
     > a.acquisition_cost - a.salvage_value THEN
    RAISE EXCEPTION
      'Posting % for % would depreciate asset % below its salvage value.',
      NEW.depreciation_amount, NEW.period, a.asset_number
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

CREATE TRIGGER "asset_depreciation_within_cost"
BEFORE INSERT OR UPDATE OF status ON "asset_depreciation_schedule"
FOR EACH ROW EXECUTE FUNCTION asset_depreciation_within_cost();--> statement-breakpoint

-- ============================================================================
-- What an asset is actually carrying — decision 1.
--
-- `accumulated_depreciation` and `book_value` were stored columns on the asset,
-- and `recordDepreciation` set them from the SCHEDULE ROW being posted:
--
--     this.accumulatedDepreciation = entry.accumulatedDepreciation;
--
-- The schedule row's figure is a projection of every month up to that point.
-- Post March without January and February — which `postDepreciation` permits,
-- because it takes the period from the form and looks only for a pending row
-- in that month — and the ledger receives one month while the register claims
-- three. The two then disagree for good.
--
-- Here the position is a sum over what has actually been POSTED, plus
-- impairments, which are the only other thing that credits accumulated
-- depreciation. There is nowhere for a second figure to live.
--
-- `pending_before_period` is what makes the gap visible rather than merely
-- impossible: it counts the months still outstanding, so a month-end run can
-- refuse to skip them instead of silently leaving a hole.
-- ============================================================================
CREATE VIEW "asset_state" AS
SELECT a.id                                                   AS asset_id,
       a.company_id,
       a.status,
       a.category,
       a.acquisition_cost,
       a.salvage_value,

       COALESCE(d.posted_total, 0)::numeric(19,4)             AS posted_depreciation,
       COALESCE(i.impaired_total, 0)::numeric(19,4)           AS impairment_total,
       (COALESCE(d.posted_total, 0)
        + COALESCE(i.impaired_total, 0))::numeric(19,4)       AS accumulated_depreciation,
       (a.acquisition_cost
        - COALESCE(d.posted_total, 0)
        - COALESCE(i.impaired_total, 0))::numeric(19,4)       AS book_value,

       -- What the schedule still expects to charge.
       COALESCE(d.pending_total, 0)::numeric(19,4)            AS pending_depreciation,
       COALESCE(d.periods_posted, 0)                          AS periods_posted,
       COALESCE(d.periods_pending, 0)                         AS periods_pending,
       d.last_posted_period,
       d.next_pending_period,
       -- Months that fell through: still pending, and older than the newest
       -- month already posted. Zero unless somebody skipped one.
       COALESCE(d.periods_missed, 0)                          AS periods_missed,

       -- What the schedule will never charge: the book value it leaves standing
       -- above salvage once every month has been posted. Zero for straight
       -- line, which trues up; positive for reducing balance, which is
       -- asymptotic and simply stops. Decision 5.
       GREATEST(
         a.acquisition_cost
           - COALESCE(d.scheduled_total, 0)
           - COALESCE(i.impaired_total, 0)
           - a.salvage_value,
         0
       )::numeric(19,4)                                       AS unwritten_residue,

       u.current_usage,
       u.last_reading_at,
       a.usage_unit
  FROM assets a
  LEFT JOIN (
    SELECT s.asset_id,
           SUM(s.depreciation_amount)                                     AS scheduled_total,
           SUM(s.depreciation_amount) FILTER (WHERE s.status = 'posted')  AS posted_total,
           SUM(s.depreciation_amount) FILTER (WHERE s.status = 'pending') AS pending_total,
           COUNT(*) FILTER (WHERE s.status = 'posted')::integer           AS periods_posted,
           COUNT(*) FILTER (WHERE s.status = 'pending')::integer          AS periods_pending,
           MAX(s.period) FILTER (WHERE s.status = 'posted')               AS last_posted_period,
           MIN(s.period) FILTER (WHERE s.status = 'pending')              AS next_pending_period,
           COUNT(*) FILTER (
             WHERE s.status = 'pending'
               AND s.period < (SELECT MAX(p.period)
                                 FROM asset_depreciation_schedule p
                                WHERE p.asset_id = s.asset_id AND p.status = 'posted')
           )::integer                                                     AS periods_missed
      FROM asset_depreciation_schedule s
     GROUP BY s.asset_id
  ) d ON d.asset_id = a.id
  LEFT JOIN (
    SELECT DISTINCT ON (r.asset_id)
           r.asset_id, r.reading AS current_usage, r.recorded_at AS last_reading_at
      FROM asset_usage_readings r
     ORDER BY r.asset_id, r.recorded_at DESC, r.id DESC
  ) u ON u.asset_id = a.id
  LEFT JOIN (
    SELECT asset_id, SUM(amount) AS impaired_total
      FROM asset_impairments GROUP BY asset_id
  ) i ON i.asset_id = a.id;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'assets',
    'asset_depreciation_schedule',
    'asset_transfers',
    'asset_impairments',
    'asset_usage_readings',
    'asset_documents',
    'asset_journal_entries'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "assets" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_depreciation_schedule" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_transfers" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_impairments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_usage_readings" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_documents" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "asset_journal_entries" TO app_user;--> statement-breakpoint
GRANT SELECT ON "asset_state" TO app_user;

ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'fixed_asset';
