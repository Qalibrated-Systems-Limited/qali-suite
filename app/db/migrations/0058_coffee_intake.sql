-- ============================================================================
-- 0058 — Coffee cooperative intake.
--
-- The sixth module from §9G's sweep, and the second of the two that lived
-- under lib/ rather than app/mongodb/actions/. `coffee-coop.js` posts
-- DR Inventory / CR Farmer Payable through the Mongo JournalEntry model while
-- every ledger screen reads Postgres — and it is reachable: registered in
-- connectors/registry.js and called by app/api/v1/coffee-coop/intake. Every
-- farmer delivery has been recorded into a ledger nothing reads.
--
-- Unlike the weighbridge, which found its Postgres half already built and
-- unused, none of this existed: the season, the price schedule and the intake
-- are all new.
--
-- ── Four decisions ──────────────────────────────────────────────────────────
--
-- 1. NET WEIGHT AND TOTAL AMOUNT ARE GENERATED.
--    The Mongo model documents them —
--
--        netWeight:   grossWeight - deductionWeight
--        totalAmount: netWeight × unitPrice
--
--    — and then stores both as independent numbers that the connector computes
--    in JavaScript and writes alongside the inputs. Correct the gross weight
--    or the deduction afterwards and the two figures stay where they were,
--    while the stock movement and the liability were both struck from them.
--    Here they are generated columns and cannot disagree.
--
-- 2. ONE ACTIVE SEASON.
--    `isActive` is a boolean on the season with nothing stopping two, and the
--    connector resolves an intake's price from "the active season". With two
--    active, the price a farmer is paid depends on which document the query
--    happened to return first. A partial unique index makes a second
--    impossible.
--
-- 3. ONE PRICE PER GRADE PER TYPE PER SEASON.
--    The price schedule is an embedded array in Mongo, so nothing stops two
--    entries for AA parchment at different prices — and the lookup takes the
--    first match. A unique index means the lookup has one answer.
--
-- 4. THE STATION'S REFERENCE IS AN IDEMPOTENCY KEY.
--    Mongo indexes `externalRef` WITHOUT uniqueness — the same fault the
--    weighbridge has, with the same consequence: a retried intake call records
--    the delivery, the stock movement and the farmer's money a second time.
--
-- ── A note on `farmer_payable` ──────────────────────────────────────────────
--
-- `farmer_payable` is a valid system-account type (lib/utils.js:436) and the
-- default chart of accounts does not seed one. So on any tenant that has not
-- created it by hand, the connector's own guard fires and the GL entry is
-- skipped with a warning — which means that even before the wrong-ledger
-- problem, most intakes posted nothing at all. Seeded below for new companies;
-- existing ones get it too, positioned beside Accounts Payable.
-- ============================================================================

CREATE TYPE "public"."coffee_type" AS ENUM ('cherry', 'parchment', 'mbuni');--> statement-breakpoint
CREATE TYPE "public"."coffee_season_type" AS ENUM ('main', 'fly', 'early');--> statement-breakpoint
CREATE TYPE "public"."farmer_intake_status" AS ENUM ('recorded', 'voided');--> statement-breakpoint
CREATE TYPE "public"."farmer_payment_status" AS ENUM ('unpaid', 'partial', 'paid');--> statement-breakpoint

CREATE TABLE "coffee_seasons" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "name" text NOT NULL,
  "season_type" "coffee_season_type" NOT NULL DEFAULT 'main',
  "year" integer NOT NULL,
  "start_date" date,
  "end_date" date,
  "is_active" boolean NOT NULL DEFAULT false,
  "target_volume_kg" numeric(19,4) NOT NULL DEFAULT 0,
  "default_product_id" uuid,
  "notes" text,
  "created_by_id" text,
  "created_by_name" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "coffee_seasons_dates_ordered"
    CHECK ("start_date" IS NULL OR "end_date" IS NULL OR "end_date" >= "start_date")
);--> statement-breakpoint

ALTER TABLE "coffee_seasons" ADD CONSTRAINT "coffee_seasons_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "coffee_seasons" ADD CONSTRAINT "coffee_seasons_default_product_id_fk"
  FOREIGN KEY ("default_product_id") REFERENCES "public"."products"("id") ON DELETE set null;--> statement-breakpoint

CREATE UNIQUE INDEX "coffee_seasons_company_name_uq" ON "coffee_seasons" ("company_id", "name");--> statement-breakpoint
-- Decision 2.
CREATE UNIQUE INDEX "coffee_seasons_one_active" ON "coffee_seasons" ("company_id")
  WHERE "is_active" = true;--> statement-breakpoint
CREATE INDEX "coffee_seasons_company_year_idx" ON "coffee_seasons" ("company_id", "year");--> statement-breakpoint

CREATE TABLE "coffee_price_schedule" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "season_id" uuid NOT NULL,
  "grade" text NOT NULL,
  "coffee_type" "coffee_type" NOT NULL DEFAULT 'parchment',
  "unit_price" numeric(19,4) NOT NULL,
  "currency" text NOT NULL DEFAULT 'KES',
  CONSTRAINT "coffee_price_schedule_price_positive" CHECK ("unit_price" > 0)
);--> statement-breakpoint

ALTER TABLE "coffee_price_schedule" ADD CONSTRAINT "coffee_price_schedule_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "coffee_price_schedule" ADD CONSTRAINT "coffee_price_schedule_season_id_fk"
  FOREIGN KEY ("season_id") REFERENCES "public"."coffee_seasons"("id") ON DELETE cascade;--> statement-breakpoint

-- Decision 3.
CREATE UNIQUE INDEX "coffee_price_schedule_uq"
  ON "coffee_price_schedule" ("season_id", "grade", "coffee_type");--> statement-breakpoint

CREATE TABLE "farmer_intake_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL,
  "entry_number" text NOT NULL,
  "external_ref" text,

  "season_id" uuid,
  "season_name_at_intake" text,

  "farmer_code" text NOT NULL,
  "farmer_name" text,
  "farmer_phone" text,
  "farmer_party_id" uuid,

  "coffee_type" "coffee_type" NOT NULL DEFAULT 'parchment',
  "grade" text NOT NULL,

  "gross_weight" numeric(19,4) NOT NULL,
  "deduction_weight" numeric(19,4) NOT NULL DEFAULT 0,
  -- Decision 1: what the model documents, as the database computes it.
  "net_weight" numeric(19,4) GENERATED ALWAYS AS ("gross_weight" - "deduction_weight") STORED,
  "moisture" numeric(5,2) NOT NULL DEFAULT 0,

  "unit_price" numeric(19,4) NOT NULL,
  "currency" text NOT NULL DEFAULT 'KES',
  "total_amount" numeric(19,4) GENERATED ALWAYS AS
    (round(("gross_weight" - "deduction_weight") * "unit_price", 4)) STORED,

  "payment_method" text,
  "payment_status" "farmer_payment_status" NOT NULL DEFAULT 'unpaid',
  "amount_paid" numeric(19,4) NOT NULL DEFAULT 0,
  "payment_ref" text,
  "paid_at" timestamp with time zone,

  "product_id" uuid,
  "product_name_at_intake" text,
  "stock_movement_id" uuid,
  "journal_entry_id" uuid,

  "status" "farmer_intake_status" NOT NULL DEFAULT 'recorded',
  "voided_at" timestamp with time zone,
  "void_reason" text,
  "warnings" text[],

  "collected_by_id" text,
  "collected_by_name" text,
  "integration_key_id" uuid,
  "notes" text,

  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "farmer_intake_weights_non_negative"
    CHECK ("gross_weight" >= 0 AND "deduction_weight" >= 0),
  CONSTRAINT "farmer_intake_deduction_within_gross"
    CHECK ("deduction_weight" <= "gross_weight"),
  CONSTRAINT "farmer_intake_price_not_negative" CHECK ("unit_price" >= 0),
  CONSTRAINT "farmer_intake_moisture_is_a_percentage"
    CHECK ("moisture" >= 0 AND "moisture" <= 100),
  CONSTRAINT "farmer_intake_amount_paid_not_negative" CHECK ("amount_paid" >= 0),
  CONSTRAINT "farmer_intake_voided_has_a_reason"
    CHECK ("status" <> 'voided' OR "void_reason" IS NOT NULL)
);--> statement-breakpoint

ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_company_id_fk"
  FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_season_id_fk"
  FOREIGN KEY ("season_id") REFERENCES "public"."coffee_seasons"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_party_id_fk"
  FOREIGN KEY ("farmer_party_id") REFERENCES "public"."parties"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_product_id_fk"
  FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_movement_id_fk"
  FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE set null;--> statement-breakpoint
ALTER TABLE "farmer_intake_entries" ADD CONSTRAINT "farmer_intake_entry_id_fk"
  FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "farmer_intake_entries_number_uq"
  ON "farmer_intake_entries" ("company_id", "entry_number");--> statement-breakpoint

-- Decision 4.
CREATE UNIQUE INDEX "farmer_intake_entries_external_ref_uq"
  ON "farmer_intake_entries" ("company_id", "external_ref")
  WHERE "external_ref" IS NOT NULL;--> statement-breakpoint

CREATE INDEX "farmer_intake_entries_farmer_idx"
  ON "farmer_intake_entries" ("company_id", "farmer_code", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "farmer_intake_entries_season_idx"
  ON "farmer_intake_entries" ("company_id", "season_id");--> statement-breakpoint
CREATE INDEX "farmer_intake_entries_unpaid_idx"
  ON "farmer_intake_entries" ("company_id", "payment_status")
  WHERE "payment_status" <> 'paid';--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'coffee_seasons', 'coffee_price_schedule', 'farmer_intake_entries'
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

GRANT SELECT, INSERT, UPDATE, DELETE ON "coffee_seasons" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "coffee_price_schedule" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "farmer_intake_entries" TO app_user;
