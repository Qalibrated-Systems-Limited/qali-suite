-- ─────────────────────────────────────────────────────────────────────────────
-- 0066 — Stock adjustments.
--
-- The last module of substance posting journal entries into MongoDB. Two
-- tables replace a 825-line Mongoose model, and most of what that model did by
-- hand is stated here instead.
--
-- WHAT BECAME A CONSTRAINT, and stopped being a method:
--
--   validateLines()'s two arithmetic checks    generated columns. The model
--                                              recomputed the expected values
--                                              and threw when the stored ones
--                                              disagreed; a stored value that
--                                              can disagree is the bug. There
--                                              is nothing to disagree with now.
--   "reason required for every line"           NOT NULL + a non-empty CHECK
--   "can only approve draft adjustments"       the status pair CHECKs below
--   "cannot take stock below zero"             products_quantities_non_negative
--                                              (0013) — the adjustment does not
--                                              need to look first
--
-- WHAT IS DELIBERATELY NOT STORED: the three totals. The Mongo document
-- carried totalIncreaseValue, totalDecreaseValue and totalAdjustmentValue,
-- written by calculateTotals() on every approve. They are a sum over the
-- lines, so they are derived on read here — and one of them was wrong.
-- calculateTotals() summed line.adjustmentValue into totalAdjustmentValue, and
-- validateLines() defines adjustmentValue as ABS(quantity) * unit_cost, so a
-- stock take with 100,000 found and 100,000 damaged stored 200,000 as its
-- "total adjustment value" while its true effect on inventory was zero. That
-- figure reaches the user through getAdjustmentStats()'s by-type breakdown.
-- The port reports the net. A deliberate divergence; the tests assert it.
--
-- ON opening_balance: the enum keeps the value, and nothing in this branch
-- writes it. Opening stock is posted by createProductPg (product-actions.ts,
-- postOpeningStock) straight to Opening Balance Equity, which is where the
-- Mongo model's own comment says it belongs. The value survives so that a
-- migrated row can still name what it was.
-- ─────────────────────────────────────────────────────────────────────────────

-- An approved adjustment posts to the ledger, so it can be a journal entry's
-- source — and the `journal_entries_source_pair` CHECK means `source_id`
-- cannot be set without it. ADD VALUE only: nothing in this migration writes
-- the value, which is what keeps it legal inside the migrator's transaction.
ALTER TYPE "public"."source_document_type"
  ADD VALUE IF NOT EXISTS 'stock_adjustment';--> statement-breakpoint

CREATE TYPE "public"."adjustment_type" AS ENUM(
  'physical_count', 'damage', 'expiry', 'theft', 'correction',
  'write_off', 'found', 'opening_balance', 'other'
);--> statement-breakpoint

CREATE TYPE "public"."adjustment_status" AS ENUM('draft', 'approved', 'cancelled');--> statement-breakpoint

CREATE TABLE "stock_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"adjustment_number" text NOT NULL,
	"adjustment_date" date DEFAULT CURRENT_DATE NOT NULL,
	"adjustment_type" "adjustment_type" NOT NULL,
	"status" "adjustment_status" DEFAULT 'draft' NOT NULL,
	"journal_entry_id" uuid,
	"description" text,
	"notes" text,
	"reference_number" text,
	"approved_at" timestamp with time zone,
	"approved_by_id" text,
	"approved_by_name" text,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancelled_by_name" text,
	"cancellation_reason" text,
	"created_by_id" text,
	"created_by_name" text NOT NULL,
	"last_modified_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- Both halves of an approval, or neither, and only on an approved row.
	-- Written as a biconditional on the STATUS rather than on the columns,
	-- because the case that happens is an UPDATE that flips the status and
	-- forgets the rest.
	CONSTRAINT "stock_adjustments_approval_pair" CHECK (
		("stock_adjustments"."status" = 'approved')
		= ("stock_adjustments"."approved_at" IS NOT NULL
		   AND "stock_adjustments"."approved_by_name" IS NOT NULL)
	),

	-- Cancellation is only reachable from draft (the Mongo cancel() refuses
	-- anything else), so a cancelled row was never approved and the two
	-- biconditionals cannot both demand the same row.
	CONSTRAINT "stock_adjustments_cancellation_pair" CHECK (
		("stock_adjustments"."status" = 'cancelled')
		= ("stock_adjustments"."cancelled_at" IS NOT NULL
		   AND "stock_adjustments"."cancelled_by_name" IS NOT NULL
		   AND "stock_adjustments"."cancellation_reason" IS NOT NULL)
	),

	-- A draft has posted nothing. An approved adjustment whose lines net to
	-- zero posts nothing either, so the entry is optional in that direction.
	CONSTRAINT "stock_adjustments_entry_only_when_approved" CHECK (
		"stock_adjustments"."journal_entry_id" IS NULL
		OR "stock_adjustments"."status" = 'approved'
	)
);
--> statement-breakpoint

CREATE TABLE "stock_adjustment_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"adjustment_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,

	-- Snapshots, as everywhere else: what the product was called when the
	-- count happened, not what it is called now.
	"product_sku_at_adjustment" text DEFAULT '' NOT NULL,
	"product_name_at_adjustment" text DEFAULT '' NOT NULL,
	"product_unit_at_adjustment" text DEFAULT '' NOT NULL,

	"system_quantity" numeric(19, 4) NOT NULL,
	"physical_quantity" numeric(19, 4) NOT NULL,
	"unit_cost" numeric(19, 4) NOT NULL,

	-- The two figures validateLines() used to recompute and compare.
	-- A generated column cannot reference another generated column, so the
	-- value is written out from the base columns rather than from the quantity.
	"adjustment_quantity" numeric(19, 4)
		GENERATED ALWAYS AS ("physical_quantity" - "system_quantity") STORED,
	"adjustment_value" numeric(19, 4)
		GENERATED ALWAYS AS (ABS("physical_quantity" - "system_quantity") * "unit_cost") STORED,

	"reason" text NOT NULL,
	"stock_movement_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "stock_adjustment_lines_quantities_non_negative" CHECK (
		"stock_adjustment_lines"."system_quantity" >= 0
		AND "stock_adjustment_lines"."physical_quantity" >= 0
	),
	CONSTRAINT "stock_adjustment_lines_unit_cost_non_negative" CHECK (
		"stock_adjustment_lines"."unit_cost" >= 0
	),
	CONSTRAINT "stock_adjustment_lines_reason_not_blank" CHECK (
		length(btrim("stock_adjustment_lines"."reason")) > 0
	)
);
--> statement-breakpoint

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_journal_entry_id_journal_entries_id_fk" FOREIGN KEY ("journal_entry_id") REFERENCES "public"."journal_entries"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_id_users_id_fk" FOREIGN KEY ("approved_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_adjustment_lines" ADD CONSTRAINT "stock_adjustment_lines_stock_movement_id_stock_movements_id_fk" FOREIGN KEY ("stock_movement_id") REFERENCES "public"."stock_movements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "stock_adjustments_company_number_uq" ON "stock_adjustments" USING btree ("company_id","adjustment_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_adjustments_id_company_uq" ON "stock_adjustments" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "stock_adjustments_company_date_idx" ON "stock_adjustments" USING btree ("company_id","adjustment_date" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "stock_adjustments_company_status_idx" ON "stock_adjustments" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "stock_adjustments_company_type_idx" ON "stock_adjustments" USING btree ("company_id","adjustment_type");--> statement-breakpoint
CREATE INDEX "stock_adjustment_lines_adjustment_idx" ON "stock_adjustment_lines" USING btree ("adjustment_id");--> statement-breakpoint
CREATE INDEX "stock_adjustment_lines_company_product_idx" ON "stock_adjustment_lines" USING btree ("company_id","product_id");--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_adjustments', 'stock_adjustment_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_adjustments" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_adjustment_lines" TO app_user;
