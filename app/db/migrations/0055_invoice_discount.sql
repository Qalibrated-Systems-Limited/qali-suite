-- ============================================================================
-- 0055 — The invoice discount the port dropped, and the cap that governed it.
--
-- MongoDB had this right. The port lost it. Both halves.
--
-- ── The value ───────────────────────────────────────────────────────────────
--
-- `CreateInvoiceForm` computes a header discount, shows the discounted total
-- on screen, and posts `discountPercentage` in its JSON payload.
-- `invoiceDataSchema` has no such field, so it is dropped at parse, and the
-- lines go through at full price. Measured, on 2 x 500 with 10% off:
--
--     the form showed:   subtotal 1000.00   discount 100.00   total 1044.00
--     the database took: subtotal 1000.00   discount   0.00   total 1160.00
--
-- The customer is invoiced 116 more than the screen quoted, and the PDF prints
-- the higher figure.
--
-- Mongo stores `discountPercentage` and `totalDiscount` on the invoice
-- (`invoice-actions.js:488`), and `invoice.js:767-800` computes the tax with a
-- proportional discount factor. That behaviour is restored here, unchanged.
--
-- ── The control ─────────────────────────────────────────────────────────────
--
-- `invoice-actions.js:685-713` refuses any discount above the company's
-- `discountCapPercent` unless the user holds a pricing-policy role — and its
-- own comment records that an earlier version FAILED OPEN, letting a tenant
-- with unseeded settings discount by 100%.
--
-- `discount_cap_percent` has existed in Postgres since 0035 and is read by
-- `companyConfig.ts`. Nothing on the Postgres invoice write path has ever
-- enforced it, because the enforcement stayed in the Mongo action that no
-- screen calls any more. So the port dropped the discount AND the rule that
-- bounded it: any discount, from anyone, silently discarded.
--
-- The cap is enforced in `invoice-actions.ts` (it needs the caller's role, and
-- roles are not in the database). The CHECK below is the floor under it: a
-- percentage is a percentage, whoever writes it.
--
-- ── One deliberate difference from Mongo ────────────────────────────────────
--
-- Mongo computes all of this in JavaScript floats and rounds to 2dp at each
-- step (`lib/money.js`). Here it is NUMERIC(19,4) throughout, which is the
-- entire point of §2.1 — the discount factor in particular is a division, and
-- a repeating decimal through float is exactly the drift this migration exists
-- to remove. The RULE is Mongo's; the ARITHMETIC is exact.
-- ============================================================================

ALTER TABLE "invoices"
  ADD COLUMN IF NOT EXISTS "discount_percentage" numeric(9,4) NOT NULL DEFAULT 0;--> statement-breakpoint

ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_discount_percentage_is_a_percentage";--> statement-breakpoint

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_discount_percentage_is_a_percentage"
  CHECK ("discount_percentage" >= 0 AND "discount_percentage" <= 100);--> statement-breakpoint

-- A discount cannot exceed what is being discounted.
ALTER TABLE "invoices"
  DROP CONSTRAINT IF EXISTS "invoices_discount_within_subtotal";--> statement-breakpoint

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_discount_within_subtotal"
  CHECK ("discount_total" <= "subtotal");
