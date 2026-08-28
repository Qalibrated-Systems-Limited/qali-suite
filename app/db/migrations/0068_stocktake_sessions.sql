-- ─────────────────────────────────────────────────────────────────────────────
-- 0068 — Stocktake sessions.
--
-- The `physical_count` adjustment type has been there since the Mongo model,
-- and the only way to use it was to type the counted number straight into an
-- adjustment form. That is not a stocktake — it is a correction with a label.
-- What was missing is everything between: a sheet, a freeze, somebody counting
-- against it, and somebody else looking at the variance before it moves the
-- books.
--
-- THE FREEZE IS THE POINT, and it is the thing most easily got wrong.
-- `system_quantity` on a line is what the BOOK said when the sheet was
-- generated, and it never changes afterwards. It exists to answer "how far out
-- were we", which is the number a stocktake is run to produce.
--
-- IT IS NOT WHAT THE ADJUSTMENT CORRECTS FROM. Stock keeps moving while people
-- count: a sale between the freeze and the posting is a real movement, not a
-- discrepancy, and correcting from the frozen figure would silently reverse it.
-- Posting builds the adjustment from the COUNTED quantities and lets the
-- adjustment layer read the live book quantity inside its own transaction —
-- which `createStockAdjustmentPg` already does, deliberately, for this reason.
-- So the count sets the stock to what was counted, and the variance report
-- says what the book had claimed when counting began. Both are true and they
-- are different numbers.
--
-- BLIND COUNTING is a flag rather than a separate flow. A counter who can see
-- the expected number tends to find it; hiding the system quantity on the
-- sheet is the standard control, and it costs one boolean here and one
-- condition in the UI. The frozen quantity is still stored — it is hidden from
-- the counter, not from the reviewer.
--
-- WHAT IS LEFT TO THE DATABASE, as everywhere on this branch:
--
--   a line counted twice          `counted_at` / `counted_by_id` pair CHECK
--   a variance nobody computed    generated columns
--   posting an uncounted sheet    the repository, since "every line counted"
--                                 is a statement about a SET of rows and a
--                                 row CHECK cannot see its siblings
--   a posted count without its    stock_counts_posting_pair
--   adjustment
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE "public"."stock_count_status" AS ENUM(
  'draft', 'counting', 'review', 'posted', 'cancelled'
);--> statement-breakpoint

CREATE TABLE "stock_counts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"count_number" text NOT NULL,
	"count_date" date DEFAULT CURRENT_DATE NOT NULL,
	"name" text NOT NULL,
	"notes" text,
	"status" "stock_count_status" DEFAULT 'draft' NOT NULL,

	-- What the sheet covers. Null category means the whole active catalogue;
	-- the sheet itself is the record of what was included, so a category
	-- renamed or re-parented afterwards cannot change what was counted.
	"category_id" uuid,

	-- The counter does not see the expected number.
	"is_blind" boolean DEFAULT true NOT NULL,

	-- When the sheet was generated and the system quantities were frozen.
	"frozen_at" timestamp with time zone,

	"posted_at" timestamp with time zone,
	"posted_by_id" text,
	"posted_by_name" text,
	"adjustment_id" uuid,

	"cancelled_at" timestamp with time zone,
	"cancelled_by_id" text,
	"cancelled_by_name" text,
	"cancellation_reason" text,

	"created_by_id" text,
	"created_by_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,

	-- A sheet exists from `counting` onwards, and the freeze is what makes it
	-- one. Written as a conditional on the STATUS, because the case that
	-- happens is an UPDATE that advances the status and forgets the rest.
	CONSTRAINT "stock_counts_frozen_once_open" CHECK (
		("stock_counts"."status" IN ('draft', 'cancelled'))
		OR "stock_counts"."frozen_at" IS NOT NULL
	),

	-- A posted count has all three, and only a posted count has any of them.
	-- `adjustment_id` is NOT in the biconditional: a count where every line
	-- matched posts nothing, and a stocktake that finds no variance is the
	-- good outcome rather than an incomplete one.
	CONSTRAINT "stock_counts_posting_pair" CHECK (
		("stock_counts"."status" = 'posted')
		= ("stock_counts"."posted_at" IS NOT NULL
		   AND "stock_counts"."posted_by_name" IS NOT NULL)
	),
	CONSTRAINT "stock_counts_adjustment_only_when_posted" CHECK (
		"stock_counts"."adjustment_id" IS NULL
		OR "stock_counts"."status" = 'posted'
	),

	CONSTRAINT "stock_counts_cancellation_pair" CHECK (
		("stock_counts"."status" = 'cancelled')
		= ("stock_counts"."cancelled_at" IS NOT NULL
		   AND "stock_counts"."cancelled_by_name" IS NOT NULL
		   AND "stock_counts"."cancellation_reason" IS NOT NULL)
	),

	CONSTRAINT "stock_counts_name_not_blank" CHECK (
		length(btrim("stock_counts"."name")) > 0
	)
);
--> statement-breakpoint

CREATE TABLE "stock_count_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"count_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,

	"product_sku_at_count" text DEFAULT '' NOT NULL,
	"product_name_at_count" text DEFAULT '' NOT NULL,
	"product_unit_at_count" text DEFAULT '' NOT NULL,

	-- FROZEN when the sheet was generated. Never updated.
	"system_quantity" numeric(19, 4) NOT NULL,
	-- Frozen too, so the value of a variance does not move because somebody
	-- received stock at a different price while the count was open.
	"unit_cost" numeric(19, 4) NOT NULL,

	-- NULL until somebody counts it, which is what makes "not yet counted"
	-- distinguishable from "counted, and it agreed".
	"counted_quantity" numeric(19, 4),
	"counted_by_id" text,
	"counted_at" timestamp with time zone,
	"notes" text,

	-- NULL while uncounted, and that is the useful behaviour: a variance
	-- report cannot accidentally read an uncounted line as a zero-variance one.
	"variance_quantity" numeric(19, 4)
		GENERATED ALWAYS AS ("counted_quantity" - "system_quantity") STORED,
	"variance_value" numeric(19, 4)
		GENERATED ALWAYS AS (("counted_quantity" - "system_quantity") * "unit_cost") STORED,

	"created_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "stock_count_lines_quantities_non_negative" CHECK (
		"stock_count_lines"."system_quantity" >= 0
		AND ("stock_count_lines"."counted_quantity" IS NULL
		     OR "stock_count_lines"."counted_quantity" >= 0)
	),
	CONSTRAINT "stock_count_lines_unit_cost_non_negative" CHECK (
		"stock_count_lines"."unit_cost" >= 0
	),
	-- A count without a counter and a time is not a count. All three or none.
	CONSTRAINT "stock_count_lines_counted_pair" CHECK (
		("stock_count_lines"."counted_quantity" IS NULL)
		= ("stock_count_lines"."counted_at" IS NULL)
	)
);
--> statement-breakpoint

ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_adjustment_id_stock_adjustments_id_fk" FOREIGN KEY ("adjustment_id") REFERENCES "public"."stock_adjustments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_posted_by_id_users_id_fk" FOREIGN KEY ("posted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_cancelled_by_id_users_id_fk" FOREIGN KEY ("cancelled_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_counts" ADD CONSTRAINT "stock_counts_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_count_id_stock_counts_id_fk" FOREIGN KEY ("count_id") REFERENCES "public"."stock_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_count_lines" ADD CONSTRAINT "stock_count_lines_counted_by_id_users_id_fk" FOREIGN KEY ("counted_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "stock_counts_company_number_uq" ON "stock_counts" USING btree ("company_id","count_number");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_counts_id_company_uq" ON "stock_counts" USING btree ("id","company_id");--> statement-breakpoint
CREATE INDEX "stock_counts_company_status_idx" ON "stock_counts" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "stock_counts_company_date_idx" ON "stock_counts" USING btree ("company_id","count_date" DESC NULLS LAST);--> statement-breakpoint

-- A product appears once on a sheet. Counting the same item twice on one sheet
-- is a data-entry error, not a second opinion — a recount OVERWRITES the line.
CREATE UNIQUE INDEX "stock_count_lines_count_product_uq" ON "stock_count_lines" USING btree ("count_id","product_id");--> statement-breakpoint
CREATE INDEX "stock_count_lines_company_product_idx" ON "stock_count_lines" USING btree ("company_id","product_id");--> statement-breakpoint
-- Drives the review screen, which opens on the lines that disagree.
CREATE INDEX "stock_count_lines_variance_idx" ON "stock_count_lines" USING btree ("count_id") WHERE "stock_count_lines"."variance_quantity" <> 0;--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['stock_counts', 'stock_count_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format($f$
      CREATE POLICY tenant_isolation ON %I
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
    $f$, t);
  END LOOP;
END $$;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_counts" TO app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "stock_count_lines" TO app_user;
