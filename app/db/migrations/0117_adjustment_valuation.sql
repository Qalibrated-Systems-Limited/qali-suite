-- ============================================================================
-- STOCK ADMITTED WITHOUT A COST IS VALUED BEFORE IT IS APPROVED — 0117
--
-- THE HOLE THIS CLOSES. `decideRouting` refuses to auto-approve an adjustment
-- that admits stock at a `unit_cost` of zero, and the note beside it says why:
-- "SAP and NetSuite refuse a zero-cost receipt outright; here it goes to
-- finance to establish a cost."
--
-- It went nowhere of the sort. The routed request was raised as type
-- `stock_adjustment`, whose approver matrix is
-- [SuperAdmin, Admin, Manager, Store Manager] — CFO and Finance Manager are
-- not on it, so the queue of the people it was "sent to finance" for was
-- empty. And whoever could see it had no way to supply a cost: approving it
-- admitted the goods at zero, moved the quantity, and posted NO journal entry
-- at all, because the entry is skipped when the lines net to nothing.
--
-- The result was the worst available outcome. The guard fired, a second
-- signature was demanded, and the thing it was guarding against happened
-- anyway: quantity on the shelf rose, the balance sheet did not move, and the
-- units sat there with no cost to charge to COGS when they sold.
--
-- WHAT REPLACES IT — three parts, and the third is the one that makes the
-- first two hold.
--
-- 1. `pending_valuation`, a status before draft. An adjustment that admits
--    stock the company cannot value is not a draft waiting for a signature;
--    it is a document missing a number nobody has supplied yet, and saying so
--    is what stops it being approved by someone who thinks it is complete.
--
-- 2. `stock_valuation`, an approval type routed at finance and procurement —
--    the roles that may set a cost (lib/permissions.js COST_SETTER_ROLES).
--    NOT `stock_writeoff`, which was the other candidate and is wrong: a
--    write-off is stock LEAVING the books and this is stock entering them.
--    Borrowing an approval matrix by mislabelling the economics of the
--    transaction is how a register stops meaning anything.
--
-- 3. A trigger that refuses to approve an adjustment holding a positive line
--    with no cost, whatever route it took to get there. Parts 1 and 2 are
--    routing, and routing is advisory — it can be bypassed by a direct write,
--    a future caller, or a status set by hand during a repair. The invariant
--    is that stock never enters the books at a value nobody established, and
--    an invariant belongs where it cannot be gone around.
--
-- WHAT IS DELIBERATELY NOT GUARDED: a DECREASE at zero cost. Writing nothing
-- off is arithmetically nothing, posts nothing, and is the ordinary result of
-- counting a product that was itself never valued. It is the admission of
-- unvalued goods that misstates the balance sheet, not the removal of them.
--
-- NOR is an existing weighted-average cost second-guessed. A positive count
-- variance on a product that already carries a defensible average is valued
-- at that average and follows the ordinary approval path — `unit_cost` is
-- read from the product when the line is written, so the guard below only
-- ever fires where that read produced nothing.
-- ============================================================================

-- ADD VALUE only, and nothing in this migration writes either one — that is
-- what keeps them legal inside the migrator's transaction (see 0050).
ALTER TYPE "public"."adjustment_status"
  ADD VALUE IF NOT EXISTS 'pending_valuation' BEFORE 'approved';--> statement-breakpoint

ALTER TYPE "public"."approval_type"
  ADD VALUE IF NOT EXISTS 'stock_valuation';--> statement-breakpoint

-- ── Who supplied the valuation, and when ────────────────────────────────────
-- Recorded on the adjustment rather than inferred from the approval, because
-- the two are different acts by potentially different people: procurement may
-- establish a cost that finance then approves. "Who decided these goods were
-- worth this" is the question an auditor asks about admitted stock, and the
-- approver's name does not answer it.
ALTER TABLE "stock_adjustments"
  ADD COLUMN IF NOT EXISTS "valued_at" timestamp with time zone;--> statement-breakpoint

ALTER TABLE "stock_adjustments"
  ADD COLUMN IF NOT EXISTS "valued_by_id" text
  REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint

ALTER TABLE "stock_adjustments"
  ADD COLUMN IF NOT EXISTS "valued_by_name" text;--> statement-breakpoint

-- Both or neither, and paired on the NAME rather than the id: the id is
-- nulled when the user row goes, and the record of who valued the stock must
-- outlive the account that did it. The approval and cancellation pairs on this
-- table are written the same way, for the same reason.
ALTER TABLE "stock_adjustments"
  DROP CONSTRAINT IF EXISTS "stock_adjustments_valuation_pair";--> statement-breakpoint

ALTER TABLE "stock_adjustments"
  ADD CONSTRAINT "stock_adjustments_valuation_pair"
  CHECK (("valued_at" IS NOT NULL) = ("valued_by_name" IS NOT NULL));--> statement-breakpoint

-- ── The invariant ───────────────────────────────────────────────────────────
-- A trigger and not a CHECK, because the condition spans two tables: a CHECK
-- may only see the row it is defined on, and what makes an approval illegal
-- lives in the lines.
--
-- BEFORE UPDATE, and only on the transition INTO approved. Re-saving an
-- already-approved row — which nothing does today, but repairs and backfills
-- do — must not be refused for a state it was already in, and historical rows
-- approved before this migration are left exactly as they are. This governs
-- what may be approved from now on; it does not rewrite the past.
CREATE OR REPLACE FUNCTION stock_adjustment_refuse_unvalued_approval()
RETURNS trigger AS $$
DECLARE
  v_sku text;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN
    RETURN NEW;
  END IF;

  SELECT p.sku INTO v_sku
    FROM stock_adjustment_lines l
    JOIN products p ON p.id = l.product_id
   WHERE l.adjustment_id = NEW.id
     AND l.adjustment_quantity > 0
     AND COALESCE(l.unit_cost, 0) <= 0
   LIMIT 1;

  IF v_sku IS NOT NULL THEN
    RAISE EXCEPTION
      'stock_adjustment_positive_line_needs_cost: % admits stock with no cost. A unit cost has to be established before this adjustment can be approved.',
      v_sku;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS "stock_adjustments_valued_before_approval"
  ON "stock_adjustments";--> statement-breakpoint

CREATE TRIGGER "stock_adjustments_valued_before_approval"
  BEFORE UPDATE ON "stock_adjustments"
  FOR EACH ROW
  EXECUTE FUNCTION stock_adjustment_refuse_unvalued_approval();--> statement-breakpoint
