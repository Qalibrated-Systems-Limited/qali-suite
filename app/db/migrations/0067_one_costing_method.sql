-- ─────────────────────────────────────────────────────────────────────────────
-- 0067 — One costing method, honestly.
--
-- `costing_method` offered five values and the system implements one.
--
--   average             weighted average. The only one that does anything.
--   weighted_average    a DUPLICATE of it, and the wizard's default — and the
--                       three re-costing expressions all guard on
--                       `costing_method <> 'average'`, so a product carrying
--                       this value would never have been re-costed at all.
--                       Its cost_price would sit at whatever it was first set
--                       to while every receipt at a different price was
--                       ignored, and every COGS figure downstream inherits it.
--   fifo, lifo,         not implemented anywhere. Selecting one silently gave
--   specific            weighted average.
--
-- IT WAS NEVER ACTUALLY STORED, which is the only reason the duplicate has not
-- already done damage: `addProductPg` does not read the form's costingMethod
-- and `updateProductPg` cannot change it, so every product took the column
-- default. The picker was decorative — five options, one outcome.
--
-- The choice here is to say one true thing rather than five things that are
-- not. The column stays, narrowed to the method the system performs, so the
-- schema states it; the picker goes; and the unreachable `<> 'average'`
-- branches come out of the three re-costing expressions rather than sitting
-- there as a hook nothing can reach.
--
-- FIFO IS A COSTING-LAYERS TABLE, not an enum value. When there is a reason to
-- add it, it arrives as `stock_cost_layers` plus consumption on issue, and
-- this enum grows a value at the same time. Adding a value back is one line;
-- what could not be undone is a system that claims to do FIFO and does not.
-- ─────────────────────────────────────────────────────────────────────────────

-- A value cannot be dropped from a Postgres enum, so the type is replaced.
-- Every existing row is already 'average' — nothing else was ever written.
ALTER TABLE "products"
  ALTER COLUMN "costing_method" DROP DEFAULT;--> statement-breakpoint

CREATE TYPE "public"."costing_method_new" AS ENUM('average');--> statement-breakpoint

ALTER TABLE "products"
  ALTER COLUMN "costing_method" TYPE "public"."costing_method_new"
  USING (
    -- Defensive, though the set is provably {average}: anything that is not
    -- the implemented method BECOMES it, because that is what the system was
    -- doing to it regardless of what the column said.
    CASE WHEN "costing_method"::text = 'average' THEN 'average'
         ELSE 'average' END
  )::"public"."costing_method_new";--> statement-breakpoint

DROP TYPE "public"."costing_method";--> statement-breakpoint

ALTER TYPE "public"."costing_method_new" RENAME TO "costing_method";--> statement-breakpoint

ALTER TABLE "products"
  ALTER COLUMN "costing_method" SET DEFAULT 'average';--> statement-breakpoint

ALTER TABLE "products"
  ALTER COLUMN "costing_method" SET NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- The COMPANY default follows it.
--
-- `company_settings.default_costing_method` is a text column with its own
-- CHECK allowing 'average', 'fifo' and 'lifo' — so a company could set a
-- default that no product is able to take, and the settings screen would
-- accept it. Narrowed to the same one method, and any row already holding
-- something else is moved to it, because that is what the system was doing to
-- those products regardless.
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE "company_settings"
   SET "default_costing_method" = 'average'
 WHERE "default_costing_method" <> 'average';--> statement-breakpoint

ALTER TABLE "company_settings"
  DROP CONSTRAINT IF EXISTS "company_settings_costing_valid";--> statement-breakpoint

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_costing_valid"
  CHECK ("default_costing_method" = 'average');
