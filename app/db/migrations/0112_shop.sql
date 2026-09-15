-- ─────────────────────────────────────────────────────────────────────────────
-- 0112 — Online Shop.
--
-- The storefront, integrated with the real inventory rather than a parallel
-- catalogue:
--   shop_listings    — an overlay on `products` (product_id → products): a row
--                      means "on the storefront", with an optional price
--                      override. The Catalog tab is products LEFT JOIN this.
--   shop_orders      — storefront orders; item_count/total stamped from lines.
--   shop_order_lines — the ordered products, each optionally pointing at the
--                      real product sold. Cascades from its order.
-- Order numbers from next_entry_number('ORD'). Company-scoped, forced RLS.
-- Touches only these three new tables.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE "shop_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"listed" boolean DEFAULT true NOT NULL,
	"shop_price" double precision,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE TABLE "shop_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_number" text NOT NULL,
	"customer_name" text DEFAULT '' NOT NULL,
	"customer_party_id" text,
	"customer_email" text DEFAULT '' NOT NULL,
	"item_count" integer DEFAULT 0 NOT NULL,
	"total" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'awaiting_payment' NOT NULL,
	"placed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"created_by_id" text,
	"created_by_name" text DEFAULT 'System' NOT NULL,
	"last_modified_by_id" text,
	"last_modified_by_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_orders_status_valid" CHECK ("status" IN ('awaiting_payment','paid','shipped','delivered','cancelled'))
);
--> statement-breakpoint

CREATE TABLE "shop_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"description" text DEFAULT '' NOT NULL,
	"qty" double precision DEFAULT 1 NOT NULL,
	"unit_price" double precision DEFAULT 0 NOT NULL,
	"line_total" double precision DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_listings" ADD CONSTRAINT "shop_listings_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_orders" ADD CONSTRAINT "shop_orders_last_modified_by_id_users_id_fk" FOREIGN KEY ("last_modified_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "shop_order_lines" ADD CONSTRAINT "shop_order_lines_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_order_lines" ADD CONSTRAINT "shop_order_lines_order_id_shop_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."shop_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_order_lines" ADD CONSTRAINT "shop_order_lines_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "shop_listings_company_product_idx" ON "shop_listings" USING btree ("company_id","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "shop_orders_company_number_idx" ON "shop_orders" USING btree ("company_id","order_number");--> statement-breakpoint
CREATE INDEX "shop_orders_status_idx" ON "shop_orders" USING btree ("company_id","status");--> statement-breakpoint
CREATE INDEX "shop_orders_placed_idx" ON "shop_orders" USING btree ("company_id","placed_at");--> statement-breakpoint
CREATE INDEX "shop_order_lines_order_idx" ON "shop_order_lines" USING btree ("order_id");--> statement-breakpoint

-- Row-level security — same tenant_isolation policy as every company table.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shop_listings','shop_orders','shop_order_lines']
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
