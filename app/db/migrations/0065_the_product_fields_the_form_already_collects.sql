-- ============================================================================
-- 0065 — The product fields the form already collects.
--
-- The add/edit product form posts eleven fields the `products` table has no
-- column for. Porting the screens without these would either drop what the
-- user typed or force the form to be cut down, and neither is a change the
-- port is entitled to make on its own.
--
-- FOUR ARE REAL AND ARRIVE HERE:
--
--   default_tax_rate   Every ERP that handles VAT carries a rate on the
--                      product and pre-fills the invoice line from it — Xero,
--                      QuickBooks and Odoo all do. The Postgres invoice path
--                      defaults each LINE to 16 instead, so a zero-rated or
--                      exempt item has to be corrected by hand on every
--                      invoice. Defaulted to 16 to match what invoices.ts
--                      already assumes, so nothing changes until it is set.
--
--   reorder_quantity   How much to reorder, as against reorder_level, which is
--                      when. Standard pair; the table had only the trigger.
--
--   location           Warehouse and bin. Standard WMS fields, and the only
--   bin_number         place a physical count can start from.
--
-- TWO ARE DELIBERATELY NOT ADDED:
--
--   track_inventory    Redundant. `product_type` already separates an
--                      'Inventory Item' from a service, which is the same
--                      distinction, and the Mongo action used the flag for
--                      exactly one decision — whether opening stock posts.
--                      Two columns encoding one fact drift the first time
--                      somebody sets one and not the other.
--
--   allow_negative_stock
--                      UNIMPLEMENTABLE HERE, and that is the right outcome.
--                      `products_quantities_non_negative` (0008) forbids a
--                      negative level outright. Mongo collected this flag on
--                      every product and no code ever read it, so it promised
--                      a behaviour it did not have; the constraint delivers
--                      the safe half of it and refuses the unsafe half.
--
-- The remaining form fields — costingMethod, isActive, category, unit, type —
-- already have columns.
-- ============================================================================

ALTER TABLE "products"
  ADD COLUMN IF NOT EXISTS "default_tax_rate" numeric(9,4) NOT NULL DEFAULT 16,
  ADD COLUMN IF NOT EXISTS "reorder_quantity" numeric(19,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "location" text,
  ADD COLUMN IF NOT EXISTS "bin_number" text;--> statement-breakpoint

-- A rate is a percentage, and a negative one is not a discount.
ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_tax_rate_range";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_tax_rate_range"
  CHECK ("default_tax_rate" >= 0 AND "default_tax_rate" <= 100);--> statement-breakpoint

ALTER TABLE "products"
  DROP CONSTRAINT IF EXISTS "products_reorder_quantity_non_negative";--> statement-breakpoint
ALTER TABLE "products"
  ADD CONSTRAINT "products_reorder_quantity_non_negative"
  CHECK ("reorder_quantity" >= 0);
