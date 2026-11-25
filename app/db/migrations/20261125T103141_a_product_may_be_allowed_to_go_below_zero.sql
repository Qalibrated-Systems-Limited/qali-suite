-- ============================================================================
-- A PRODUCT MAY BE ALLOWED TO GO BELOW ZERO
--
-- 0065 declined `allow_negative_stock`: the form offered a switch that no code
-- read, and `products_quantities_non_negative` forbade a negative level. The
-- switch has since been asked for — selling or issuing ahead of a receipt
-- that is on its way is ordinary practice — so it is now real, PER PRODUCT,
-- and off unless someone switches it on:
--
--   * a product with it OFF behaves exactly as before: on hand never below 0,
--     and committed + on hold never more than on hand;
--   * a product with it ON may have on hand below zero. Committed and on hold
--     still may not be negative (they are counts of reservations).
--
-- SAFE TO APPLY because: the column defaults to false, so every existing
-- product keeps the rule it has; both constraints are only relaxed for a
-- product that opts in.
-- ============================================================================

ALTER TABLE "products" ADD COLUMN "allow_negative_stock" boolean DEFAULT false NOT NULL;--> statement-breakpoint

ALTER TABLE "products" DROP CONSTRAINT "products_quantities_non_negative";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_quantities_non_negative" CHECK (
  ("allow_negative_stock" OR "quantity_on_hand" >= 0)
  AND "quantity_committed" >= 0 AND "quantity_on_hold" >= 0
);--> statement-breakpoint

ALTER TABLE "products" DROP CONSTRAINT "products_commitments_within_on_hand";--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_commitments_within_on_hand" CHECK (
  "allow_negative_stock" OR ("quantity_committed" + "quantity_on_hold") <= "quantity_on_hand"
);
