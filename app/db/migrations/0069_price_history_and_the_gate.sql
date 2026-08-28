-- ─────────────────────────────────────────────────────────────────────────────
-- 0069 — Price history, and the gate that was lost with the port.
--
-- TWO THINGS THAT BELONG TOGETHER, because they are the same hole seen from
-- either side: nothing records a price change, and nothing stops one.
--
-- WHAT WAS LOST. `stock-actions.js:985` gated a price change on three
-- conditions — selling below the product's own floor (`minimumPrice`), selling
-- below COST, and a margin under the company's `minimumMarginPercent` — routed
-- it to the `price_change` approval type, and did NOT apply the change until
-- somebody signed it. `PRICING_OVERRIDE_ROLES` bypassed it. There was even a
-- guard against stacking two pending approvals on one product.
--
-- `updateProductPricingPg` has none of that. It sets three columns. So on this
-- branch anybody who may edit pricing can sell below cost with no sign-off,
-- and `price_change` sits in APPROVER_MATRIX as a type nothing raises. The
-- Mongo path that did raise it is unreachable — no screen imports it — and its
-- applier edits a Mongo product no screen reads. Dead at all three points.
--
-- WHAT IS NOT RECORDED HERE, deliberately: COST changes. Cost moves on its own
-- every time stock is received or adjusted, by weighted average, and logging
-- each one would bury the deliberate changes under thousands of derived ones.
-- The provenance of a cost already exists — `stock_movements` carries
-- `unit_cost` and `average_cost_at_movement` for every movement that caused it.
-- What had no record at all is somebody choosing a new PRICE, so that is what
-- this table holds. `cost_at_change` travels with each row so the margin at the
-- time can be reconstructed without joining back through the movements.
--
-- ONE ROW PER FIELD THAT MOVED, not one per save. A save that changes the
-- selling price and leaves the floor alone writes one row, and the CHECK
-- refuses a row where the value did not change — a history full of no-ops is
-- worse than none, because it hides the changes that matter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "product_price_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,

	-- Which price moved. Not an enum: three values that are unlikely to grow,
	-- and a CHECK reads better beside them than a type declared elsewhere.
	"field" text NOT NULL,

	"old_value" numeric(19, 4) NOT NULL,
	"new_value" numeric(19, 4) NOT NULL,

	-- The cost basis at the moment of the change, so the margin then is
	-- answerable later without reconstructing it from the movement history.
	"cost_at_change" numeric(19, 4) DEFAULT '0' NOT NULL,

	-- Why, when a gate made somebody say. Free text; the approval carries the
	-- structured version.
	"reason" text,
	-- The approval that released it, when one did. Text rather than a foreign
	-- key: the ApprovalRequest engine is still Mongo, so this holds its
	-- requestNumber and cannot be a reference.
	"approval_ref" text,

	"changed_by_id" text,
	"changed_by_name" text NOT NULL,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "product_price_history_field_valid" CHECK (
		"product_price_history"."field" IN ('selling', 'wholesale', 'minimum')
	),
	CONSTRAINT "product_price_history_values_non_negative" CHECK (
		"product_price_history"."old_value" >= 0
		AND "product_price_history"."new_value" >= 0
		AND "product_price_history"."cost_at_change" >= 0
	),
	-- A history entry that records no change is noise that hides the signal.
	CONSTRAINT "product_price_history_actually_changed" CHECK (
		"product_price_history"."old_value" <> "product_price_history"."new_value"
	)
);
--> statement-breakpoint

ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_price_history" ADD CONSTRAINT "product_price_history_changed_by_id_users_id_fk" FOREIGN KEY ("changed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- The dashboard card reads the most recent across the company; the product
-- page reads one product's. Both are covered.
CREATE INDEX "product_price_history_company_date_idx" ON "product_price_history" USING btree ("company_id","changed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "product_price_history_product_idx" ON "product_price_history" USING btree ("product_id","changed_at" DESC NULLS LAST);--> statement-breakpoint

-- ─────────────────────────────────────────────────────────────────────────────
-- Row-level security.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "product_price_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_price_history" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "product_price_history"
  USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
  WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);--> statement-breakpoint

GRANT SELECT, INSERT ON "product_price_history" TO app_user;
